// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  }),
}));
vi.mock('../store/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'worker-7' } }) },
}));

import { readWithSnapshot } from './snapshot-cache';

beforeEach(() => {
  store.clear();
  vi.restoreAllMocks();
});

describe('offline read snapshots', () => {
  it('stores successful responses in an account-scoped snapshot and serves it without a request offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const load = vi.fn(async () => [{ id: 'order-1', status: 'issued' }]);
    await expect(readWithSnapshot('orders:active', load)).resolves.toEqual([
      { id: 'order-1', status: 'issued' },
    ]);
    expect([...store.keys()][0]).toBe('naryadai.snapshot.v1:worker-7:orders:active');

    online.mockReturnValue(false);
    const offlineLoad = vi.fn(async () => []);
    await expect(readWithSnapshot('orders:active', offlineLoad)).resolves.toEqual([
      { id: 'order-1', status: 'issued' },
    ]);
    expect(offlineLoad).not.toHaveBeenCalled();
  });

  it('falls back to the last snapshot on a connection failure but never hides an HTTP permission/not-found error', async () => {
    await readWithSnapshot('order:1', async () => ({ id: '1', status: 'issued' }));
    const connectionFailure = new AxiosError('Network Error');
    await expect(
      readWithSnapshot('order:1', async () => {
        throw connectionFailure;
      }),
    ).resolves.toEqual({ id: '1', status: 'issued' });
    const forbidden = new AxiosError('Forbidden', undefined, undefined, undefined, {
      status: 403,
      data: {},
    } as never);
    await expect(
      readWithSnapshot('order:1', async () => {
        throw forbidden;
      }),
    ).rejects.toBe(forbidden);
  });

  it('does not invent data when no snapshot exists and expires snapshots older than thirty days', async () => {
    const connectionFailure = new AxiosError('Network Error');
    await expect(
      readWithSnapshot('orders:history', async () => {
        throw connectionFailure;
      }),
    ).rejects.toBe(connectionFailure);
    await readWithSnapshot('orders:history', async () => ['cached']);
    const now = Date.now();
    const saved = store.get('naryadai.snapshot.v1:worker-7:orders:history') as {
      savedAt: number;
      value: string[];
    };
    store.set('naryadai.snapshot.v1:worker-7:orders:history', {
      ...saved,
      savedAt: now - 31 * 24 * 60 * 60 * 1000,
    });
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await expect(
      readWithSnapshot('orders:history', async () => {
        throw connectionFailure;
      }),
    ).rejects.toBe(connectionFailure);
  });

  it('keeps online reads working when browser storage is unavailable or full', async () => {
    const idb = await import('idb-keyval');
    vi.mocked(idb.get).mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    vi.mocked(idb.set).mockRejectedValueOnce(new Error('quota exceeded'));
    const load = vi.fn(async () => [{ id: 'fresh-order' }]);

    await expect(readWithSnapshot('orders:fresh', load)).resolves.toEqual([{ id: 'fresh-order' }]);
    expect(load).toHaveBeenCalledOnce();
  });
});
