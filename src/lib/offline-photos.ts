import { get, set } from 'idb-keyval';
import { newUUID } from './api-client';
import { useAuthStore } from '../store/auth-store';

export type OfflinePhotoKind = 'before' | 'after';

export interface OfflinePhotoRecord {
  localId: string;
  kind: OfflinePhotoKind;
  name: string;
  type: string;
  createdAt: string;
  data: Blob;
}

export interface PendingPhotoRef {
  localId: string;
  kind: OfflinePhotoKind;
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
): Promise<OfflinePhotoRecord> {
  const rec: OfflinePhotoRecord = {
    localId: newUUID(),
    kind,
    name: name ?? (file instanceof File ? file.name : 'photo.jpg'),
    type: file.type || 'image/jpeg',
    createdAt: new Date().toISOString(),
    data: file instanceof File ? file : new Blob([file], { type: file.type }),
  };
  const all = await listOfflinePhotos(userId);
  await set(offlinePhotoKey(userId), [...all, rec]);
  return rec;
}

export async function removeOfflinePhotos(userId: string, localIds: string[]): Promise<void> {
  if (localIds.length === 0) return;
  try {
    const condemned = new Set(localIds);
    const all = await listOfflinePhotos(userId);
    const kept = all.filter((p) => !condemned.has(p.localId));
    if (kept.length !== all.length) await set(offlinePhotoKey(userId), kept);
  } catch {
    /* best effort: replay must not fail on photo-index cleanup */
  }
}
