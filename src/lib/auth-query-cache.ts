import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth-store';

/** Remove the old URL-only API cache; static PWA assets remain available offline. */
export async function clearLegacyApiCache() {
  if (typeof caches === 'undefined') return;
  try {
    await caches.delete('naryadai-catalog');
  } catch {
    // Restricted WebViews can disable CacheStorage; it must not prevent login.
  }
}

/** Query keys describe screens, so invalidate their identity when the user changes. */
export function bindAuthQueryCache(client: QueryClient) {
  void clearLegacyApiCache();
  return useAuthStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) {
      client.clear();
      void clearLegacyApiCache();
    }
  });
}
