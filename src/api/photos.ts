import { api } from '../lib/api-client';

export type PhotoKind = 'before' | 'after';

/** Client-side compression: max 1600px, JPEG q0.8 — backend stores originals privately. */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
  return blob ?? file;
}

export interface UploadResult { id: string; url?: string; replayed?: boolean }

export async function uploadPhoto(
  file: File | Blob,
  kind: PhotoKind,
  orderId?: string,
  onProgress?: (pct: number) => void,
): Promise<UploadResult> {
  const blob = file instanceof File ? await compressImage(file) : file;
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', blob, 'photo.jpg');
  const path = orderId ? `/work-orders/${orderId}/photos` : '/photos';
  const { data } = await api.post(path, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000,
    onUploadProgress: (e) => {
      if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return data;
}

export async function photoUrl(photoId: string): Promise<string> {
  const { data } = await api.get(`/photos/${photoId}/url`);
  return data.url;
}

export async function listOrderPhotos(orderId: string): Promise<UploadResult[]> {
  try {
    const { data } = await api.get(`/work-orders/${orderId}/photos`);
    // Бэкенд отдаёт {"data": [...]}
    return Array.isArray(data) ? data : (data.items ?? data.data ?? []);
  } catch {
    return [];
  }
}
