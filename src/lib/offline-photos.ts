import { get, set } from 'idb-keyval';
import { newUUID } from './api-client';
import { useAuthStore } from '../store/auth-store';

export type OfflinePhotoKind = 'before' | 'after';
export type OfflinePhotoSource = 'camera' | 'picker';

export interface OfflinePhotoRecord {
  localId: string;
  kind: OfflinePhotoKind;
  name: string;
  type: string;
  createdAt: string;
  source?: OfflinePhotoSource;
  data: Blob;
}

export interface PendingPhotoRef {
  localId: string;
  kind: OfflinePhotoKind;
  source?: OfflinePhotoSource;
}

interface OfflinePhotoDraft {
  draftKey: string;
  photos: PendingPhotoRef[];
}

const draftKey = (userId: string) => `naryadai.offline-photo-drafts:${userId}`;
const keyLocks = new Map<string, Promise<unknown>>();

function withKeyLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  keyLocks.set(key, current);
  return current.finally(() => {
    if (keyLocks.get(key) === current) keyLocks.delete(key);
  });
}

/** Per-employee photo blob storage. Never share blobs between accounts on one phone. */
export function offlinePhotoKey(userId: string): string {
  return `naryadai.offline-photos:${userId}`;
}

export function currentOfflineUserId(): string {
  return useAuthStore.getState().user?.id ?? 'anonymous';
}

export async function listOfflinePhotos(userId: string): Promise<OfflinePhotoRecord[]> {
  try {
    const saved = (await get<OfflinePhotoRecord[]>(offlinePhotoKey(userId))) ?? [];
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export async function getOfflinePhoto(
  userId: string,
  localId: string,
): Promise<OfflinePhotoRecord | undefined> {
  const all = await listOfflinePhotos(userId);
  return all.find((p) => p.localId === localId);
}

export async function saveOfflinePhoto(
  userId: string,
  file: File | Blob,
  kind: OfflinePhotoKind,
  name?: string,
  source?: OfflinePhotoSource,
): Promise<OfflinePhotoRecord> {
  const rec: OfflinePhotoRecord = {
    localId: newUUID(),
    kind,
    name: name ?? (file instanceof File ? file.name : 'photo.jpg'),
    type: file.type || 'image/jpeg',
    createdAt: new Date().toISOString(),
    source,
    data: file instanceof File ? file : new Blob([file], { type: file.type }),
  };
  await withKeyLock(offlinePhotoKey(userId), async () => {
    const all = await listOfflinePhotos(userId);
    await set(offlinePhotoKey(userId), [...all, rec]);
  });
  return rec;
}

export async function removeOfflinePhotos(userId: string, localIds: string[]): Promise<void> {
  if (localIds.length === 0) return;
  try {
    const condemned = new Set(localIds);
    await withKeyLock(offlinePhotoKey(userId), async () => {
      const all = await listOfflinePhotos(userId);
      const kept = all.filter((p) => !condemned.has(p.localId));
      if (kept.length !== all.length) await set(offlinePhotoKey(userId), kept);
    });
  } catch {
    /* best effort: replay must not fail on photo-index cleanup */
  }
}

export async function listOfflinePhotoDraftRefs(
  userId: string,
  key: string,
): Promise<PendingPhotoRef[]> {
  try {
    const drafts = (await get<OfflinePhotoDraft[]>(draftKey(userId))) ?? [];
    return drafts.find((draft) => draft.draftKey === key)?.photos ?? [];
  } catch {
    return [];
  }
}

export async function listAllOfflinePhotoDraftRefs(userId: string): Promise<PendingPhotoRef[]> {
  try {
    const drafts = (await get<OfflinePhotoDraft[]>(draftKey(userId))) ?? [];
    return drafts.flatMap((draft) => draft.photos);
  } catch {
    return [];
  }
}

export async function addOfflinePhotoDraftRef(
  userId: string,
  key: string,
  photo: PendingPhotoRef,
): Promise<void> {
  await withKeyLock(draftKey(userId), async () => {
    const drafts = (await get<OfflinePhotoDraft[]>(draftKey(userId))) ?? [];
    const current = drafts.find((draft) => draft.draftKey === key);
    const photos = current?.photos ?? [];
    if (photos.some((item) => item.localId === photo.localId)) return;
    const next: OfflinePhotoDraft[] = current
      ? drafts.map((draft) =>
          draft.draftKey === key ? { ...draft, photos: [...draft.photos, photo] } : draft,
        )
      : [...drafts, { draftKey: key, photos: [photo] }];
    await set(draftKey(userId), next);
  });
}

export async function removeOfflinePhotoDraftRefs(
  userId: string,
  key: string,
  localIds: string[],
): Promise<void> {
  if (localIds.length === 0) return;
  await withKeyLock(draftKey(userId), async () => {
    const drafts = (await get<OfflinePhotoDraft[]>(draftKey(userId))) ?? [];
    const condemned = new Set(localIds);
    const next = drafts
      .map((draft) =>
        draft.draftKey === key
          ? { ...draft, photos: draft.photos.filter((photo) => !condemned.has(photo.localId)) }
          : draft,
      )
      .filter((draft) => draft.photos.length > 0);
    await set(draftKey(userId), next);
  });
}

/** Load the persisted bytes as a fresh File, never reusing the picker handle. */
export async function readStagedFile(
  userId: string,
  localId: string,
): Promise<{ file: File; record: OfflinePhotoRecord } | null> {
  const record = await getOfflinePhoto(userId, localId);
  if (!record?.data) return null;
  const file = new File([record.data], record.name || 'photo.jpg', {
    type: record.type || record.data.type || 'image/jpeg',
  });
  return { file, record };
}

/** Read the latest staged bytes for a photo immediately before replay uploads it. */
export async function readStagedBytes(userId: string, localId: string): Promise<Blob | null> {
  const record = await getOfflinePhoto(userId, localId);
  return record?.data ?? null;
}

/** Remove staged photos that are no longer referenced by pending operations. */
export async function pruneStagedPhotos(userId: string, keepLocalIds: string[]): Promise<void> {
  try {
    const keep = new Set(keepLocalIds);
    const all = await listOfflinePhotos(userId);
    const retained = all.filter((photo) => keep.has(photo.localId));
    if (retained.length !== all.length) await set(offlinePhotoKey(userId), retained);
  } catch {
    /* best effort: pruning must never break queue replay */
  }
}
