// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const store = vi.hoisted(() => new Map<string, unknown>());
const transitionMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
}));

vi.mock('../api/workOrders', () => ({ transitionOrder: transitionMock }));

import { useOfflineQueue } from './useOfflineQueue';

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  );

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('useOfflineQueue lifecycle', () => {
  it('loads persisted queue on mount', async () => {
    const saved = [
      { key: 'k1', orderId: 'o1', action: 'accept', body: {}, clientAt: new Date().toISOString() },
    ];
    store.set('naryadai.offline-queue', saved);
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await waitFor(() => expect(result.current.queue).toEqual(saved));
    expect(result.current.count).toBe(1);
  });

  it('auto-replays when browser comes back online', async () => {
    store.set('naryadai.offline-queue', [
      { key: 'k1', orderId: 'o1', action: 'start', body: {}, clientAt: new Date().toISOString() },
    ]);
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await waitFor(() => expect(result.current.queue).toHaveLength(1));
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(transitionMock).toHaveBeenCalledTimes(1));
    expect(transitionMock).toHaveBeenCalledWith('o1', 'start', {}, 'k1');
  });

  it('removes single op by key', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueue({
        key: 'a',
        orderId: 'o1',
        action: 'accept',
        body: {},
        clientAt: new Date().toISOString(),
      });
      await result.current.remove('a');
    });
    expect(result.current.queue).toEqual([]);
  });

  it('replay of empty queue does nothing', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    let out!: { sent: number; failed: number };
    await act(async () => {
      out = await result.current.replay();
    });
    expect(out).toEqual({ sent: 0, failed: 0 });
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it('tracks online status', async () => {
    const { result } = renderHook(() => useOfflineQueue(), { wrapper });
    expect(result.current.online).toBe(true);
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.online).toBe(false);
  });
});
