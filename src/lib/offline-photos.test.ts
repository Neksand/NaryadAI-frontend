// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const store = vi.hoisted(() => new Map<string, unknown>());
const transitionMock = vi.hoisted(() => vi.fn(async () => ({})));
const createMock = vi.hoisted(() => vi.fn(async () => ({ id: 'new-id' })));
const uploadMock = vi.hoisted(() => vi.fn(async () => ({ id: 'remote-photo-1' })));

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
  del: vi.fn(async (k: string) => void store.delete(k)),
}));

vi.mock('../api/workOrders', () => ({
  transitionOrder: transitionMock,
  createWorkOrder: createMock,
}));

vi.mock('../api/photos', () => ({
  uploadPhoto: uploadMock,
}));

import { useAuthStore } from '../store/auth-store';
import { listOfflinePhotos, saveOfflinePhoto, removeOfflinePhotos } from './offline-photos';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  );

const user = (id: string) => ({
  id,
  login: id,
  full_name: id,
  role: 'worker' as const,
  area_ids: [],
});

const httpErr = (status: number, message = 'Bad', code = `http_${status}`) =>
  new AxiosError('x', undefined, undefined, undefined, {
    status,
    data: { error: { code, message } },
  } as never);

beforeEach(() => {
  useAuthStore.getState().logout();
  store.clear();
  vi.clearAllMocks();
  uploadMock.mockResolvedValue({ id: 'remote-photo-1' });
  transitionMock.mockResolvedValue({});
  createMock.mockResolvedValue({ id: 'new-id' });
});

describe('offline-photos per-employee isolation', () => {
  it('stores blobs under the employee key; another user sees nothing', async () => {
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });
    const rec = await saveOfflinePhoto('worker-a', blob, 'after', 'after.jpg');
    expect(rec.localId).toBeTruthy();

    expect(await listOfflinePhotos('worker-a')).toHaveLength(1);
    expect(await listOfflinePhotos('worker-b')).toEqual([]);
    // Same browser, same IndexedDB mock, but keys are namespaced.
    expect(store.has('naryadai.offline-photos:worker-a')).toBe(true);
    expect(store.has('naryadai.offline-photos:worker-b')).toBe(false);

    await removeOfflinePhotos('worker-a', [rec.localId]);
    expect(await listOfflinePhotos('worker-a')).toEqual([]);
  });
});

describe('offline queue upload-then-act with photos', () => {
  it('queues with photo offline, survives reload, flushes exactly once with photo_ids', async () => {
    act(() => useAuthStore.getState().setSession(user('worker-a'), 'token-a'));
    const first = renderHook(() => useOfflineQueue(), { wrapper });
    await waitFor(() => expect(first.result.current.queue).toEqual([]));

    const blob = new Blob(['img'], { type: 'image/jpeg' });
    await act(async () => {
      await first.result.current.enqueueWithPhotos(
        {
          key: 'complete-1',
          orderId: 'o1',
          action: 'complete',
          body: { comment: 'done' },
          clientAt: new Date().toISOString(),
        },
        [{ file: blob, kind: 'after', name: 'after.jpg' }],
      );
    });
    expect(first.result.current.queue).toHaveLength(1);
    expect(await listOfflinePhotos('worker-a')).toHaveLength(1);
    expect(transitionMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();

    // Reload: unmount, create a brand-new hook (new IndexedDB-backed store read).
    first.unmount();
    const second = renderHook(() => useOfflineQueue(), { wrapper });
    await waitFor(() => expect(second.result.current.queue).toHaveLength(1));

    let out!: { sent: number; failed: number };
    await act(async () => {
      out = await second.result.current.replay();
    });
    expect(out).toEqual({ sent: 1, failed: 0 });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(expect.any(Blob), 'after', 'o1');
    // Action goes only after all photos, with resolved photo_ids, same idempotency key.
    expect(transitionMock).toHaveBeenCalledTimes(1);
    expect(transitionMock).toHaveBeenCalledWith(
      'o1',
      'complete',
      expect.objectContaining({ photo_ids: ['remote-photo-1'] }),
      'complete-1',
    );
    expect(second.result.current.queue).toEqual([]);
    expect(await listOfflinePhotos('worker-a')).toEqual([]);

    // Idempotent retry: nothing is sent twice.
    await act(async () => {
      out = await second.result.current.replay();
    });
    expect(transitionMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it('does not upload or send while offline-flagged, keeps order on network failure', async () => {
    act(() => useAuthStore.getState().setSession(user('worker-a'), 'token-a'));
    const { result, unmount } = renderHook(() => useOfflineQueue(), { wrapper });
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    await act(async () => {
      await result.current.enqueueWithPhotos(
        {
          key: 'k-net',
          orderId: 'o1',
          action: 'complete',
          body: {},
          clientAt: new Date().toISOString(),
        },
        [{ file: blob, kind: 'after' }],
      );
    });
    uploadMock.mockRejectedValueOnce(new AxiosError('Network Error'));
    let out!: { sent: number; failed: number };
    await act(async () => {
      out = await result.current.replay();
    });
    expect(out).toEqual({ sent: 0, failed: 1 });
    expect(transitionMock).not.toHaveBeenCalled();
    expect(result.current.queue.map((o) => o.key)).toEqual(['k-net']);
    expect(await listOfflinePhotos('worker-a')).toHaveLength(1);
    unmount();
  });

  it('turns a 410 photo rejection into a notice and never sends the action', async () => {
    act(() => useAuthStore.getState().setSession(user('worker-a'), 'token-a'));
    const { result, unmount } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueueWithPhotos(
        {
          key: 'k-gone',
          orderId: 'o1',
          action: 'complete',
          body: {},
          clientAt: new Date().toISOString(),
        },
        [{ file: new Blob(['img'], { type: 'image/jpeg' }), kind: 'after' }],
      );
    });
    uploadMock.mockRejectedValueOnce(httpErr(410, 'photo expired', 'gone'));
    await act(async () => {
      await result.current.replay();
    });
    expect(transitionMock).not.toHaveBeenCalled();
    expect(result.current.queue).toEqual([]);
    expect(result.current.notices).toEqual([
      expect.objectContaining({ key: 'k-gone', orderId: 'o1', status: 410 }),
    ]);
    unmount();
  });

  it('records a conflict after successful upload instead of losing the photo silently', async () => {
    act(() => useAuthStore.getState().setSession(user('worker-a'), 'token-a'));
    const { result, unmount } = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await result.current.enqueueWithPhotos(
        {
          key: 'k-conflict',
          orderId: 'o1',
          action: 'complete',
          body: {},
          clientAt: new Date().toISOString(),
        },
        [{ file: new Blob(['img'], { type: 'image/jpeg' }), kind: 'after' }],
      );
    });
    transitionMock.mockRejectedValueOnce(httpErr(409, 'invalid_transition', 'invalid_transition'));
    let out!: { sent: number; failed: number };
    await act(async () => {
      out = await result.current.replay();
    });
    expect(out).toEqual({ sent: 0, failed: 1 });
    // Strict order: photo first, then the single action attempt.
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(transitionMock).toHaveBeenCalledTimes(1);
    expect(result.current.queue).toEqual([]);
    expect(result.current.notices).toEqual([
      expect.objectContaining({ key: 'k-conflict', code: 'invalid_transition', status: 409 }),
    ]);
    unmount();
  });

  it('a second employee never sees the first employee photo or queue', async () => {
    act(() => useAuthStore.getState().setSession(user('worker-a'), 'token-a'));
    const hookA = renderHook(() => useOfflineQueue(), { wrapper });
    await act(async () => {
      await hookA.result.current.enqueueWithPhotos(
        {
          key: 'private-photo-op',
          orderId: 'order-a',
          action: 'complete',
          body: {},
          clientAt: new Date().toISOString(),
        },
        [{ file: new Blob(['img'], { type: 'image/jpeg' }), kind: 'after' }],
      );
    });
    expect(hookA.result.current.queue).toHaveLength(1);
    hookA.unmount();

    act(() => useAuthStore.getState().setSession(user('worker-b'), 'token-b'));
    const hookB = renderHook(() => useOfflineQueue(), { wrapper });
    await waitFor(() => expect(hookB.result.current.queue).toEqual([]));
    expect(await listOfflinePhotos('worker-b')).toEqual([]);
    expect(await listOfflinePhotos('worker-a')).toHaveLength(1);
    await act(async () => {
      await hookB.result.current.replay();
    });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(transitionMock).not.toHaveBeenCalled();
    hookB.unmount();

    // First employee is back: their photo op still replays exactly once.
    act(() => useAuthStore.getState().setSession(user('worker-a'), 'token-a'));
    const hookA2 = renderHook(() => useOfflineQueue(), { wrapper });
    await waitFor(() => expect(hookA2.result.current.queue).toHaveLength(1));
    await act(async () => {
      await hookA2.result.current.replay();
    });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(transitionMock).toHaveBeenCalledWith(
      'order-a',
      'complete',
      expect.objectContaining({ photo_ids: ['remote-photo-1'] }),
      'private-photo-op',
    );
    hookA2.unmount();
  });

  it('creates an order with uploaded photo_ids through the same idempotent queue', async () => {
    act(() => useAuthStore.getState().setSession(user('master-a'), 'token-m'));
    const { result, unmount } = renderHook(() => useOfflineQueue(), { wrapper });
    uploadMock.mockResolvedValueOnce({ id: 'before-1' });
    await act(async () => {
      await result.current.enqueueWithPhotos(
        {
          key: 'create-1',
          orderId: 'new',
          action: 'create',
          opType: 'create',
          body: { kind: 'unplanned', description: 'Течь', photo_ids: [] },
          clientAt: new Date().toISOString(),
        },
        [{ file: new Blob(['img'], { type: 'image/jpeg' }), kind: 'before' }],
      );
    });
    await act(async () => {
      await result.current.replay();
    });
    expect(uploadMock).toHaveBeenCalledWith(expect.any(Blob), 'before', undefined);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ photo_ids: ['before-1'] }),
      'create-1',
    );
    expect(transitionMock).not.toHaveBeenCalled();
    expect(result.current.queue).toEqual([]);
    unmount();
  });
});
