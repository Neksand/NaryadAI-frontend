import { get, set } from 'idb-keyval';
import axios from 'axios';
import { useAuthStore } from '../store/auth-store';

const PREFIX = 'naryadai.snapshot.v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface Snapshot<T> {
  savedAt: number;
  value: T;
}

function storageKey(key: string): string {
  const userId = useAuthStore.getState().user?.id ?? 'anonymous';
  return `${PREFIX}:${userId}:${key}`;
}

async function cached<T>(key: string): Promise<T | undefined> {
  try {
    const entry = await get<Snapshot<T>>(key);
    if (!entry || Date.now() - entry.savedAt > MAX_AGE_MS) return undefined;
    return entry.value;
  } catch {
    // Storage can be unavailable or full; it must not break an online API read.
    return undefined;
  }
}

/** Read-through cache for worker lists/details; HTTP errors never mask fresh server truth. */
export async function readWithSnapshot<T>(key: string, load: () => Promise<T>): Promise<T> {
  const id = storageKey(key);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const saved = await cached<T>(id);
    if (saved !== undefined) return saved;
  }
  try {
    const value = await load();
    try {
      await set(id, { savedAt: Date.now(), value } satisfies Snapshot<T>);
    } catch {
      /* a successful server response remains useful without a cache */
    }
    return value;
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      const saved = await cached<T>(id);
      if (saved !== undefined) return saved;
    }
    throw error;
  }
}
