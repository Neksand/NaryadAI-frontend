// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const store = vi.hoisted(() => new Map<string, unknown>());
const transitionMock = vi.hoisted(() => vi.fn(async () => ({})));
const uploadMock = vi.hoisted(() =>
  vi.fn(async (_blob: Blob, _kind: 'before' | 'after', _orderId?: string) => ({ id: 'remote-photo' })),
);

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => void store.set(key, value)),
}));

vi.mock('../api/workOrders', () => ({ transitionOrder: transitionMock }));
vi.mock('../api/photos', () => ({ uploadPhoto: uploadMock }));

import { useAuthStore } from '../store/auth-store';
import { offlinePhotoKey, type OfflinePhotoRecord } from '../lib/offline-photos';
import { useOfflineQueue } from './useOfflineQueue';

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  );

const testUser = {
  id: 'worker-bytes',
  login: 'worker-bytes',
  full_name: 'Worker',
  role: 'worker' as const,
  area_ids: [],
};

beforeEach(() => {
  useAuthStore.getState().logout();
  store.clear();
  vi.clearAllMocks();
  uploadMock.mockResolvedValue({ id: 'remote-photo' });
  transitionMock.mockResolvedValue({});
});

describe('offline replay staged bytes', () => {
  it('uploads the latest bytes from IndexedDB when the queued operation is replayed', async () => {
    act(() => useAuthStore.getState().setSession(testUser, 'token'));
    const { result, unmount } = renderHook(() => useOfflineQueue(), { wrapper });
    await waitFor(() => expect(result.current.queue).toEqual([]));

    await act(async () => {
      await result.current.enqueueWithPhotos(
        {
          key: 'fresh-photo-bytes',
          orderId: 'order-1',
          action: 'complete',
          body: {},
          clientAt: new Date().toISOString(),
        },
        [{ file: new Blob(['bytes when queued'], { type: 'image/jpeg' }), kind: 'after' }],
      );
    });

    const photoKey = offlinePhotoKey(testUser.id);
    const [staged] = store.get(photoKey) as OfflinePhotoRecord[];
    store.set(photoKey, [
      { ...staged, data: new Blob(['replacement bytes'], { type: 'image/jpeg' }) },
    ]);

    let outcome!: { sent: number; failed: number };
    await act(async () => {
      outcome = await result.current.replay();
    });

    expect(outcome).toEqual({ sent: 1, failed: 0 });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(await uploadMock.mock.calls[0][0].text()).toBe('replacement bytes');
    expect(transitionMock).toHaveBeenCalledWith(
      'order-1',
      'complete',
      { photo_ids: ['remote-photo'] },
      'fresh-photo-bytes',
    );
    unmount();
  });

  it('records a notice and drops the operation when its staged photo is missing', async () => {
    act(() => useAuthStore.getState().setSession(testUser, 'token'));
    const { result, unmount } = renderHook(() => useOfflineQueue(), { wrapper });
    await waitFor(() => expect(result.current.queue).toEqual([]));

    await act(async () => {
      await result.current.enqueueWithPhotos(
        {
          key: 'missing-photo-bytes',
          orderId: 'order-2',
          action: 'complete',
          body: {},
          clientAt: new Date().toISOString(),
        },
        [{ file: new Blob(['temporary bytes'], { type: 'image/jpeg' }), kind: 'after' }],
      );
    });
    store.delete(offlinePhotoKey(testUser.id));

    let outcome!: { sent: number; failed: number };
    await act(async () => {
      outcome = await result.current.replay();
    });

    expect(outcome).toEqual({ sent: 0, failed: 1 });
    expect(result.current.queue).toEqual([]);
    expect(result.current.notices).toEqual([
      expect.objectContaining({
        key: 'missing-photo-bytes',
        code: 'photo_missing',
        message: expect.stringContaining('Reattach it'),
      }),
    ]);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(transitionMock).not.toHaveBeenCalled();
    unmount();
  });
});
