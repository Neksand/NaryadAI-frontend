import { get, set } from 'idb-keyval';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth-store';

export interface QueuedOp {
  key: string; // Idempotency-Key — ONE UUID per logical mutation, reused on retry
  orderId: string;
  action: string;
  body: Record<string, unknown>;
  clientAt: string;
}

export interface QueueNotice {
  key: string;
  orderId: string;
  action: string;
  code: string;
  message: string;
  status?: number;
  occurredAt: string;
}

const STORE_KEY = 'naryadai.offline-queue';
const NOTICE_KEY = 'naryadai.offline-notices';

/** Offline queue for worker mutations. Same Idempotency-Key is reused for the same op. */
export function useOfflineQueue() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? 'anonymous');
  // A shared phone must never replay one employee's actions as the next user.
  // Unscoped legacy queues cannot be safely attributed and are not replayed.
  const storeKey = `${STORE_KEY}:${userId}`;
  const noticeKey = `${NOTICE_KEY}:${userId}`;
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [notices, setNotices] = useState<QueueNotice[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [replaying, setReplaying] = useState(false);
  const [lastReplayError, setLastReplayError] = useState<string | null>(null);
  const replayLock = useRef(false);

  const persist = useCallback(
    async (q: QueuedOp[]) => {
      setQueue(q);
      await set(storeKey, q);
    },
    [storeKey],
  );

  const persistNotices = useCallback(
    async (items: QueueNotice[]) => {
      const bounded = items.slice(-20);
      setNotices(bounded);
      await set(noticeKey, bounded);
    },
    [noticeKey],
  );

  const remove = useCallback(
    async (key: string) => {
      const current = (await get<QueuedOp[]>(storeKey)) ?? [];
      await persist(current.filter((o) => o.key !== key));
    },
    [persist, storeKey],
  );

  // Повторная отправка очереди тем же Idempotency-Key — дублей не будет.
  // Фото для complete должны быть загружены до постановки в очередь (см. WorkerOrder).
  const replay = useCallback(async (): Promise<{ sent: number; failed: number }> => {
    // Online events and a manual retry can arrive together. Only one replay
    // may read and send a queue snapshot at a time.
    if (replayLock.current) return { sent: 0, failed: 0 };
    replayLock.current = true;
    let started = false;
    let sent = 0;
    let failed = 0;
    try {
      const current = (await get<QueuedOp[]>(storeKey)) ?? [];
      // Отсекаем протухшие и повреждённые записи; сервер тоже проверяет client_at.
      const fresh = current.filter((o) => {
        const age = Date.now() - new Date(o.clientAt).getTime();
        return Number.isFinite(age) && age >= 0 && age < 24 * 3600 * 1000;
      });
      if (fresh.length !== current.length) await persist(fresh);
      if (fresh.length === 0 || !navigator.onLine) return { sent: 0, failed: 0 };
      started = true;
      setReplaying(true);
      setLastReplayError(null);

      const { transitionOrder } = await import('../api/workOrders');
      for (const op of fresh) {
        if ((useAuthStore.getState().user?.id ?? 'anonymous') !== userId) break;
        try {
          await transitionOrder(op.orderId, op.action, op.body ?? {}, op.key);
          await remove(op.key);
          sent += 1;
        } catch (e) {
          // A same-key/same-body retry is replayed as its original 2xx response.
          // A 409 is a real conflict; never report it as a successful mutation.
          if (isAxiosError(e) && e.response) {
            const status = e.response.status;
            const apiError = (
              e.response.data as { error?: { code?: string; message?: string } } | undefined
            )?.error;
            const serverMsg = apiError?.message;
            const code =
              apiError?.code ??
              (status === 403 ? 'forbidden' : status === 404 ? 'not_found' : `http_${status}`);
            failed += 1;
            setLastReplayError(serverMsg || e.message);
            // Preserve operations that may succeed after auth/network/server recovery.
            if (
              status === 401 ||
              status === 407 ||
              status === 408 ||
              status === 425 ||
              status === 429 ||
              status >= 500
            ) {
              break;
            }
            // State/permission/deleted-order conflicts can never become valid by retrying.
            // Drop them, preserve an explanation, and refetch the affected card/list.
            const notice: QueueNotice = {
              key: op.key,
              orderId: op.orderId,
              action: op.action,
              code,
              message: serverMsg || e.message,
              status,
              occurredAt: new Date().toISOString(),
            };
            await remove(op.key);
            const savedNotices = (await get<QueueNotice[]>(noticeKey)) ?? [];
            await persistNotices([...savedNotices, notice]);
            void queryClient.invalidateQueries({ queryKey: ['orders', 'my'] });
            void queryClient.invalidateQueries({ queryKey: ['order', op.orderId] });
            continue;
          }
          failed += 1;
          setLastReplayError(e instanceof Error ? e.message : 'replay failed');
          break;
        }
      }
    } finally {
      try {
        if (started) setQueue((await get<QueuedOp[]>(storeKey)) ?? []);
      } finally {
        if (started) setReplaying(false);
        replayLock.current = false;
      }
    }
    return { sent, failed };
  }, [persist, remove, persistNotices, queryClient, storeKey, noticeKey, userId]);

  useEffect(() => {
    let active = true;
    setQueue([]);
    setNotices([]);
    setLastReplayError(null);
    void get<QueuedOp[]>(storeKey).then((q) => {
      if (active) setQueue(q ?? []);
    });
    void get<QueueNotice[]>(noticeKey).then((items) => {
      if (active) setNotices(items ?? []);
    });
    const on = () => {
      setOnline(true);
      void replay();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      active = false;
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [replay, storeKey, noticeKey]);

  const enqueue = useCallback(
    async (op: QueuedOp) => {
      const current = (await get<QueuedOp[]>(storeKey)) ?? [];
      // A key names one immutable logical operation; repeated UI events must not
      // enqueue a second payload under the same key.
      if (current.some((queued) => queued.key === op.key)) return;
      await persist([...current, op]);
    },
    [persist, storeKey],
  );

  const dismissNotice = useCallback(
    async (key: string) => {
      const current = (await get<QueueNotice[]>(noticeKey)) ?? [];
      await persistNotices(current.filter((notice) => notice.key !== key));
    },
    [persistNotices, noticeKey],
  );

  return {
    queue,
    notices,
    online,
    enqueue,
    remove,
    dismissNotice,
    replay,
    replaying,
    lastReplayError,
    count: queue.length,
  };
}
