// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const store = vi.hoisted(() => new Map<string, unknown>());
const transitionMock = vi.hoisted(() => vi.fn());

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
}));

vi.mock('../api/workOrders', () => ({ transitionOrder: transitionMock }));

import { useOfflineQueue, type QueuedOp } from './useOfflineQueue';

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  );

const op = (over: Partial<QueuedOp> = {}): QueuedOp => ({
  key: `k-${Math.random()}`,
  orderId: 'o1',
  action: 'accept',
  body: {},
  clientAt: new Date().toISOString(),
  ...over,
});

const netErr = () => new AxiosError('Network Error');
const httpErr = (status: number, message = 'Bad', code = `http_${status}`) =>
  new AxiosError('x', undefined, undefined, undefined, {
    status,
    data: { error: { code, message } },
  } as never);

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('useOfflineQueue', () => {
  it('enqueues and replays fresh ops in order', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueue(op({ key: 'k1' }));
      await result.current.enqueue(op({ key: 'k2' }));
    });
    transitionMock.mockResolvedValue({ ok: true });
    let out!: { sent: number; failed: number };
    await act(async () => {
      out = await result.current.replay();
    });
    expect(out).toEqual({ sent: 2, failed: 0 });
    expect(transitionMock.mock.calls.map((c) => c[1])).toEqual(['accept', 'accept']);
    expect(result.current.queue).toEqual([]);
  });

  it('drops ops older than 24h', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    await act(async () => {
      await result.current.enqueue(op({ key: 'old', clientAt: old }));
      await result.current.enqueue(op({ key: 'fresh' }));
    });
    transitionMock.mockResolvedValue({ ok: true });
    let out!: { sent: number; failed: number };
    await act(async () => {
      out = await result.current.replay();
    });
    expect(out.sent).toBe(1);
    expect(transitionMock).toHaveBeenCalledTimes(1);
  });

  it('treats an idempotency-key conflict as a failed operation, never as success', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueue(op({ key: 'dup' }));
    });
    transitionMock.mockRejectedValueOnce(httpErr(409, 'idempotency_key_reused'));
    let out!: { sent: number; failed: number };
    await act(async () => {
      out = await result.current.replay();
    });
    expect(out).toEqual({ sent: 0, failed: 1 });
    expect(result.current.lastReplayError).toBe('idempotency_key_reused');
    expect(result.current.queue).toEqual([]);
  });

  it.each([401, 407, 408, 425, 429, 500, 503])(
    'keeps the ordered queue after retryable HTTP %s',
    async (status) => {
      const { result } = renderHook(() => useOfflineQueue(), { wrapper });
      await act(async () => {
        await result.current.enqueue(op({ key: 'first' }));
        await result.current.enqueue(op({ key: 'second' }));
      });
      transitionMock.mockRejectedValueOnce(httpErr(status, `http_${status}`));

      let out!: { sent: number; failed: number };
      await act(async () => {
        out = await result.current.replay();
      });

      expect(out).toEqual({ sent: 0, failed: 1 });
      expect(transitionMock).toHaveBeenCalledTimes(1);
      expect(result.current.queue.map((queued) => queued.key)).toEqual(['first', 'second']);
      expect(result.current.lastReplayError).toBe(`http_${status}`);
    },
  );

  const retryableOrAlreadyCovered = new Set([401, 403, 404, 407, 408, 409, 422, 425, 429]);
  const permanentClientErrors = Array.from({ length: 100 }, (_, index) => 400 + index).filter(
    (status) => !retryableOrAlreadyCovered.has(status),
  );

  it.each(permanentClientErrors)(
    'drops terminal client response %i and persists a notice instead of retrying it',
    async (status) => {
      const { result } = renderHook(() => useOfflineQueue(), { wrapper });
      await act(async () => {
        await result.current.enqueue(op({ key: `terminal-${status}`, orderId: 'order-9' }));
      });
      transitionMock.mockRejectedValueOnce(httpErr(status, `client rejection ${status}`));

      await act(async () => {
        await result.current.replay();
      });

      expect(result.current.queue).toEqual([]);
      expect(result.current.notices).toEqual([
        expect.objectContaining({
          key: `terminal-${status}`,
          orderId: 'order-9',
          status,
          code: `http_${status}`,
        }),
      ]);
      expect(store.get('naryadai.offline-queue:anonymous')).toEqual([]);
      expect(transitionMock).toHaveBeenCalledTimes(1);
    },
  );

  it('skips rejected 4xx and continues the queue', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueue(op({ key: 'bad' }));
      await result.current.enqueue(op({ key: 'good' }));
    });
    transitionMock.mockRejectedValueOnce(httpErr(422, 'invalid_transition'));
    transitionMock.mockResolvedValueOnce({ ok: true });
    let out!: { sent: number; failed: number };
    await act(async () => {
      out = await result.current.replay();
    });
    expect(out).toEqual({ sent: 1, failed: 1 });
    expect(result.current.lastReplayError).toBe('invalid_transition');
    expect(result.current.queue).toEqual([]);
  });

  it.each([
    [409, 'invalid_transition'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [422, 'invalid_transition'],
  ])(
    'drops permanently conflicting offline action (HTTP %i, %s), records why, and refreshes its card',
    async (status, code) => {
      const { result } = renderHook(() => useOfflineQueue(), { wrapper });
      await act(async () => {
        await result.current.enqueue(
          op({ key: `conflict-${status}`, orderId: 'order-conflict', action: 'accept' }),
        );
      });
      transitionMock.mockRejectedValueOnce(
        httpErr(Number(status), `server says ${code}`, String(code)),
      );

      let first!: { sent: number; failed: number };
      await act(async () => {
        first = await result.current.replay();
      });
      expect(first).toEqual({ sent: 0, failed: 1 });
      expect(result.current.queue).toEqual([]);
      expect(result.current.notices).toEqual([
        expect.objectContaining({
          orderId: 'order-conflict',
          action: 'accept',
          code: String(code),
          status: Number(status),
          message: `server says ${code}`,
        }),
      ]);
      expect(store.get('naryadai.offline-notices:anonymous')).toHaveLength(1);

      await act(async () => {
        await result.current.replay();
      });
      expect(transitionMock).toHaveBeenCalledTimes(1);
    },
  );

  it('lets the worker dismiss an already explained sync conflict', async () => {
    store.set('naryadai.offline-notices:anonymous', [
      {
        key: 'notice-1',
        orderId: 'o1',
        action: 'accept',
        code: 'invalid_transition',
        message: 'changed',
        occurredAt: new Date().toISOString(),
      },
    ]);
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await waitFor(() => expect(result.current.notices).toHaveLength(1));
    await act(async () => {
      await result.current.dismissNotice('notice-1');
    });
    expect(result.current.notices).toEqual([]);
    expect(store.get('naryadai.offline-notices:anonymous')).toEqual([]);
  });

  it('stops on network error keeping order', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueue(op({ key: 'n1' }));
      await result.current.enqueue(op({ key: 'n2' }));
    });
    transitionMock.mockRejectedValueOnce(netErr());
    let out!: { sent: number; failed: number };
    await act(async () => {
      out = await result.current.replay();
    });
    expect(out).toEqual({ sent: 0, failed: 1 });
    expect(transitionMock).toHaveBeenCalledTimes(1);
    expect(result.current.queue.map((o) => o.key)).toEqual(['n1', 'n2']);
  });

  it('discards malformed timestamps without sending a mutation', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueue(op({ key: 'bad-date', clientAt: 'not-a-date' }));
    });

    await act(async () => {
      await result.current.replay();
    });

    expect(transitionMock).not.toHaveBeenCalled();
    expect(store.get('naryadai.offline-queue:anonymous')).toEqual([]);
    expect(result.current.count).toBe(0);
  });

  it('discards future-dated operations instead of replaying a clock-skewed action', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    const future = new Date(Date.now() + 60_000).toISOString();
    await act(async () => {
      await result.current.enqueue(op({ key: 'future', clientAt: future }));
      await result.current.replay();
    });

    expect(transitionMock).not.toHaveBeenCalled();
    expect(result.current.queue).toEqual([]);
  });

  it('expires an operation at the 24-hour boundary', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    const now = Date.now();
    await act(async () => {
      await result.current.enqueue(
        op({
          key: 'exactly-expired',
          clientAt: new Date(now - 24 * 3600 * 1000).toISOString(),
        }),
      );
    });
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    try {
      await act(async () => {
        await result.current.replay();
      });
      expect(transitionMock).not.toHaveBeenCalled();
      expect(result.current.queue).toEqual([]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keeps fresh operations untouched while the browser is offline', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueue(op({ key: 'offline' }));
    });
    const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    try {
      await act(async () => {
        await result.current.replay();
      });
      expect(transitionMock).not.toHaveBeenCalled();
      expect(result.current.queue.map((queued) => queued.key)).toEqual(['offline']);
    } finally {
      onlineSpy.mockRestore();
    }
  });

  it('replays a preserved server-error operation successfully on the next attempt', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueue(op({ key: 'retry-me' }));
    });
    transitionMock.mockRejectedValueOnce(httpErr(503, 'service unavailable'));
    transitionMock.mockResolvedValueOnce({ ok: true });

    let first!: { sent: number; failed: number };
    let second!: { sent: number; failed: number };
    await act(async () => {
      first = await result.current.replay();
    });
    expect(first).toEqual({ sent: 0, failed: 1 });
    expect(result.current.queue.map((queued) => queued.key)).toEqual(['retry-me']);

    await act(async () => {
      second = await result.current.replay();
    });
    expect(second).toEqual({ sent: 1, failed: 0 });
    expect(result.current.queue).toEqual([]);
    expect(result.current.lastReplayError).toBeNull();
  });

  it('does not enqueue a second payload under an existing idempotency key', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueue(
        op({ key: 'same', action: 'accept', body: { source: 'first' } }),
      );
      await result.current.enqueue(
        op({ key: 'same', action: 'complete', body: { source: 'second' } }),
      );
    });

    expect(result.current.queue).toHaveLength(1);
    expect(result.current.queue[0]).toMatchObject({
      key: 'same',
      action: 'accept',
      body: { source: 'first' },
    });
  });

  it('serializes concurrent replay triggers so one queued mutation is sent once', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueue(op({ key: 'one' }));
    });

    let release!: (value: unknown) => void;
    transitionMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    let firstReplay!: Promise<{ sent: number; failed: number }>;
    await act(async () => {
      firstReplay = result.current.replay();
    });
    await waitFor(() => expect(transitionMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await expect(result.current.replay()).resolves.toEqual({ sent: 0, failed: 0 });
    });
    expect(transitionMock).toHaveBeenCalledTimes(1);

    release({ ok: true });
    await act(async () => {
      await expect(firstReplay).resolves.toEqual({ sent: 1, failed: 0 });
    });
    expect(result.current.queue).toEqual([]);
  });
});
