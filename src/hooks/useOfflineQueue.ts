import { get, set } from 'idb-keyval';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth-store';
import {
  readStagedBytes,
  removeOfflinePhotos,
  saveOfflinePhoto,
  type OfflinePhotoKind,
} from '../lib/offline-photos';

export interface QueuedPhotoRef {
  localId: string;
  kind: OfflinePhotoKind;
}

export interface QueuedOp {
  key: string; // Idempotency-Key — ONE UUID per logical mutation, reused on retry
  orderId: string;
  action: string;
  body: Record<string, unknown>;
  clientAt: string;
  /** 'transition' (default) replays via transitionOrder, 'create' via createWorkOrder. */
  opType?: 'transition' | 'create';
  /** Local photo blobs (IndexedDB, per-employee) uploaded strictly before the action. */
  pendingPhotos?: QueuedPhotoRef[];
  /** localId -> remote photo id, persisted incrementally so a retry never re-uploads. */
  uploadedPhotoIds?: Record<string, string>;
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

function isRetryableStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 407 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function apiCodeFor(status: number, code?: string): string {
  if (code) return code;
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return `http_${status}`;
}

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
      const target = current.find((o) => o.key === key);
      await persist(current.filter((o) => o.key !== key));
      // Dropping a queued action must not leak its photo blobs.
      if (target?.pendingPhotos?.length) {
        try {
          await removeOfflinePhotos(
            userId,
            target.pendingPhotos.map((p) => p.localId),
          );
        } catch {
          /* photo cleanup must not break queue removal */
        }
      }
    },
    [persist, storeKey, userId],
  );

  // Повторная отправка очереди тем же Idempotency-Key — дублей не будет.
  // Операции с фото идут строго upload-then-act: сначала все блобы из
  // IndexedDB заливаются на сервер, потом действие отправляется с photo_ids.
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
      if (fresh.length !== current.length) {
        const expired = current.filter((o) => !fresh.includes(o));
        const orphanIds = expired.flatMap((o) => (o.pendingPhotos ?? []).map((p) => p.localId));
        if (orphanIds.length) {
          try {
            await removeOfflinePhotos(userId, orphanIds);
          } catch {
            /* best effort */
          }
        }
        await persist(fresh);
      }
      if (fresh.length === 0 || !navigator.onLine) return { sent: 0, failed: 0 };
      started = true;
      setReplaying(true);
      setLastReplayError(null);

      const { transitionOrder } = await import('../api/workOrders');
      // Lazily import photo/create APIs only when a queued op needs them.
      // Legacy queue tests mock only transitionOrder; touching a missing mock
      // export throws, so these imports must stay conditional.
      let uploadPhoto:
        | ((blob: Blob, kind: 'before' | 'after', orderId?: string) => Promise<{ id: string }>)
        | undefined;
      let createWorkOrder:
        undefined | ((input: Record<string, unknown>, key?: string) => Promise<unknown>);
      if (fresh.some((op) => (op.pendingPhotos ?? []).length > 0)) {
        ({ uploadPhoto } = await import('../api/photos'));
      }
      if (fresh.some((op) => op.opType === 'create')) {
        ({ createWorkOrder } = (await import('../api/workOrders')) as unknown as {
          createWorkOrder: (input: Record<string, unknown>, key?: string) => Promise<unknown>;
        });
      }
      const dropWithNotice = async (
        op: QueuedOp,
        code: string,
        message: string,
        status?: number,
      ) => {
        setLastReplayError(message);
        const notice: QueueNotice = {
          key: op.key,
          orderId: op.orderId,
          action: op.action,
          code,
          message,
          status,
          occurredAt: new Date().toISOString(),
        };
        await remove(op.key);
        const savedNotices = (await get<QueueNotice[]>(noticeKey)) ?? [];
        await persistNotices([...savedNotices, notice]);
        void queryClient.invalidateQueries({ queryKey: ['orders', 'my'] });
        void queryClient.invalidateQueries({ queryKey: ['order', op.orderId] });
      };

      for (const op of fresh) {
        if ((useAuthStore.getState().user?.id ?? 'anonymous') !== userId) break;
        // Strict upload-then-act: every pending blob is uploaded first.
        // Progress (localId -> remoteId) is persisted after each upload, so a
        // page reload or a retry never uploads the same blob twice.
        let finalBody: Record<string, unknown> = op.body ?? {};
        const pending = op.pendingPhotos ?? [];
        if (pending.length > 0) {
          let uploaded: Record<string, string> = { ...(op.uploadedPhotoIds ?? {}) };
          let outcome: 'ok' | 'dropped' | 'retry' = 'ok';
          for (const ref of pending) {
            const cached = uploaded[ref.localId];
            if (cached) continue;
            const bytes = await readStagedBytes(userId, ref.localId);
            if (!bytes) {
              // Missing staged bytes cannot be retried; explain why this op was dropped.
              failed += 1;
              await dropWithNotice(
                op,
                'photo_missing',
                'An offline photo is missing. Reattach it and submit this action again.',
              );
              outcome = 'dropped';
              break;
            }
            try {
              const targetOrderId = op.opType === 'create' ? undefined : op.orderId;
              if (!uploadPhoto) throw new Error('photo upload unavailable offline');
              const res = await uploadPhoto(bytes, ref.kind, targetOrderId);
              uploaded = { ...uploaded, [ref.localId]: res.id };
              const live = (await get<QueuedOp[]>(storeKey)) ?? [];
              const patched = live.map((queued) =>
                queued.key === op.key
                  ? {
                      ...queued,
                      uploadedPhotoIds: {
                        ...(queued.uploadedPhotoIds ?? {}),
                        [ref.localId]: res.id,
                      },
                    }
                  : queued,
              );
              // Commit the server id before dropping the only local copy. If
              // the app is terminated after this write, replay can continue
              // the action without needing the staged bytes again.
              await persist(patched);
              await removeOfflinePhotos(userId, [ref.localId]);
            } catch (e) {
              if (isAxiosError(e) && e.response) {
                const status = e.response.status;
                const apiError = (
                  e.response.data as { error?: { code?: string; message?: string } } | undefined
                )?.error;
                const serverMsg = apiError?.message ?? e.message;
                const code = apiCodeFor(status, apiError?.code);
                if (isRetryableStatus(status)) {
                  failed += 1;
                  setLastReplayError(serverMsg);
                  outcome = 'retry';
                  break;
                }
                failed += 1;
                await dropWithNotice(op, code, serverMsg, status);
                outcome = 'dropped';
                break;
              }
              failed += 1;
              setLastReplayError(e instanceof Error ? e.message : 'replay failed');
              outcome = 'retry';
              break;
            }
          }
          if (outcome === 'dropped') continue;
          if (outcome === 'retry') break;
          const existing = Array.isArray((op.body as { photo_ids?: unknown })?.photo_ids)
            ? ((op.body as { photo_ids: unknown[] }).photo_ids.filter(
                (id): id is string => typeof id === 'string',
              ) ?? [])
            : [];
          const remoteInOrder = pending
            .map((ref) => uploaded[ref.localId])
            .filter((id): id is string => typeof id === 'string');
          const merged = [...existing];
          for (const id of remoteInOrder) {
            if (!merged.includes(id)) merged.push(id);
          }
          finalBody = { ...(op.body ?? {}), photo_ids: merged };
        }
        try {
          if (op.opType === 'create') {
            if (!createWorkOrder) throw new Error('order creation unavailable offline');
            await createWorkOrder(
              { ...finalBody, photo_ids: (finalBody as { photo_ids?: string[] }).photo_ids ?? [] },
              op.key,
            );
          } else {
            await transitionOrder(op.orderId, op.action, finalBody, op.key);
          }
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
            const code = apiCodeFor(status, apiError?.code);
            failed += 1;
            setLastReplayError(serverMsg || e.message);
            // Preserve operations that may succeed after auth/network/server recovery.
            if (isRetryableStatus(status)) {
              break;
            }
            // State/permission/deleted-order conflicts can never become valid by retrying.
            // Drop them, preserve an explanation, and refetch the affected card/list.
            await dropWithNotice(op, code, serverMsg || e.message, status);
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
    // jsdom without indexedDB (MasterNew online tests) throws synchronously
    // inside idb-keyval; an async wrapper turns it into a rejection we ignore.
    const load = async () => {
      try {
        const q = await get<QueuedOp[]>(storeKey);
        if (active) setQueue(q ?? []);
      } catch {
        if (active) setQueue([]);
      }
      try {
        const items = await get<QueueNotice[]>(noticeKey);
        if (active) setNotices(items ?? []);
      } catch {
        if (active) setNotices([]);
      }
    };
    void load();
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

  /** Store photo blobs in per-employee IndexedDB first, then enqueue one idempotent op. */
  const enqueueWithPhotos = useCallback(
    async (op: QueuedOp, files: { file: File | Blob; kind: OfflinePhotoKind; name?: string }[]) => {
      const existing = (await get<QueuedOp[]>(storeKey)) ?? [];
      if (existing.some((queued) => queued.key === op.key)) return;
      const refs: QueuedPhotoRef[] = [];
      try {
        for (const f of files) {
          const rec = await saveOfflinePhoto(userId, f.file, f.kind, f.name);
          refs.push({ localId: rec.localId, kind: f.kind });
        }
      } catch (e) {
        if (refs.length) {
          try {
            await removeOfflinePhotos(
              userId,
              refs.map((r) => r.localId),
            );
          } catch {
            /* best effort rollback */
          }
        }
        throw e;
      }
      const live = (await get<QueuedOp[]>(storeKey)) ?? [];
      if (live.some((queued) => queued.key === op.key)) {
        try {
          await removeOfflinePhotos(
            userId,
            refs.map((r) => r.localId),
          );
        } catch {
          /* already enqueued elsewhere */
        }
        return;
      }
      await persist([...live, { ...op, pendingPhotos: [...(op.pendingPhotos ?? []), ...refs] }]);
    },
    [persist, storeKey, userId],
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
    enqueueWithPhotos,
    remove,
    dismissNotice,
    replay,
    replaying,
    lastReplayError,
    count: queue.length,
  };
}
