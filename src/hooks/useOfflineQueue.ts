import { get, set } from 'idb-keyval';
import { useCallback, useEffect, useState } from 'react';

export interface QueuedOp {
  key: string; // Idempotency-Key — ONE UUID per logical mutation, reused on retry
  orderId: string;
  action: string;
  body: Record<string, unknown>;
  clientAt: string;
}

const STORE_KEY = 'naryadai.offline-queue';

/** Offline queue for worker mutations. Same Idempotency-Key is reused for the same op. */
export function useOfflineQueue() {
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    void get<QueuedOp[]>(STORE_KEY).then((q) => { if (q) setQueue(q); });
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const persist = useCallback(async (q: QueuedOp[]) => {
    setQueue(q);
    await set(STORE_KEY, q);
  }, []);

  const enqueue = useCallback(async (op: QueuedOp) => {
    const current = (await get<QueuedOp[]>(STORE_KEY)) ?? [];
    await persist([...current, op]);
  }, [persist]);

  const remove = useCallback(async (key: string) => {
    const current = (await get<QueuedOp[]>(STORE_KEY)) ?? [];
    await persist(current.filter((o) => o.key !== key));
  }, [persist]);

  return { queue, online, enqueue, remove, count: queue.length };
}
