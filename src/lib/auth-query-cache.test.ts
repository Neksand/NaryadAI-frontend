// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { bindAuthQueryCache, clearLegacyApiCache } from './auth-query-cache';
import { useAuthStore } from '../store/auth-store';

const user = (id: string) => ({ id, full_name: id, role: 'worker' as const, area_ids: [] });
beforeEach(() => useAuthStore.getState().logout());
afterEach(() => vi.unstubAllGlobals());

it('clears private order results on logout and a different employee login', () => {
  const client = new QueryClient();
  const stop = bindAuthQueryCache(client);
  useAuthStore.getState().setSession(user('a'), 'token-a');
  client.setQueryData(['orders', 'my'], ['private-a']);
  useAuthStore.getState().logout();
  expect(client.getQueryData(['orders', 'my'])).toBeUndefined();
  client.setQueryData(['orders', 'my'], ['stale-session']);
  useAuthStore.getState().setSession(user('b'), 'token-b');
  expect(client.getQueryData(['orders', 'my'])).toBeUndefined();
  stop();
});

it('preserves cached data when only an access token is refreshed', () => {
  const client = new QueryClient();
  const stop = bindAuthQueryCache(client);
  useAuthStore.getState().setSession(user('a'), 'token-a');
  client.setQueryData(['orders', 'my'], ['private-a']);
  useAuthStore.getState().setAccessToken('new-token-a');
  expect(client.getQueryData(['orders', 'my'])).toEqual(['private-a']);
  stop();
});

it('evicts only the legacy unscoped API cache when the app starts', async () => {
  const remove = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('caches', { delete: remove });
  await clearLegacyApiCache();
  expect(remove).toHaveBeenCalledExactlyOnceWith('naryadai-catalog');
});

it('keeps login available when CacheStorage is unavailable or restricted', async () => {
  vi.stubGlobal('caches', undefined);
  await expect(clearLegacyApiCache()).resolves.toBeUndefined();
  vi.stubGlobal('caches', { delete: vi.fn().mockRejectedValue(new Error('restricted')) });
  await expect(clearLegacyApiCache()).resolves.toBeUndefined();
});
