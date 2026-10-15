import { api } from '../lib/api-client';
import { readWithSnapshot } from '../lib/snapshot-cache';

export type PhotoKind = 'before' | 'after';

/** Client-side compression: max 1600px, JPEG q0.8 — backend stores originals privately. */
export async function compressImage(file: File): Promise<Blob> {
  // Отдельные файлы роняют createImageBitmap/canvas в WebView (панорамы,
  // прогрессивный JPEG, HEIC). Тогда отдаём оригинал как есть — бэкенд
  // принимает до MAX_UPLOAD_BYTES, а честный отказ покажет понятный текст.
  try {
    const bitmap = await createImageBitmap(file);
    // 1280px/q0.72 ≈ 150–250 КБ: уходит даже на канале в единицы КБ/с.
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (typeof bitmap.close === 'function') bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.72));
    return blob ?? file;
  } catch {
    return file;
  }
}

export interface UploadResult {
  id: string;
  url?: string;
  replayed?: boolean;
}

/** Read JPEG EXIF DateTimeOriginal before canvas compression strips the metadata. */
export async function extractExifTakenAt(file: Blob): Promise<string | undefined> {
  const bytes = new DataView(await file.slice(0, Math.min(file.size, 2_000_000)).arrayBuffer());
  const u8 = (offset: number) =>
    offset >= 0 && offset < bytes.byteLength ? bytes.getUint8(offset) : 0;
  const u16 = (offset: number, le: boolean) =>
    offset >= 0 && offset + 2 <= bytes.byteLength ? bytes.getUint16(offset, le) : 0;
  const u32 = (offset: number, le: boolean) =>
    offset >= 0 && offset + 4 <= bytes.byteLength ? bytes.getUint32(offset, le) : 0;
  const ascii = (offset: number, length: number) =>
    Array.from({ length }, (_, i) => String.fromCharCode(u8(offset + i))).join('');
  if (bytes.byteLength < 4 || u8(0) !== 0xff || u8(1) !== 0xd8) return undefined;

  const readIfd = (tiff: number, offset: number, le: boolean) => {
    const start = tiff + offset;
    if (start + 2 > bytes.byteLength)
      return [] as { tag: number; type: number; count: number; value: number; entry: number }[];
    const count = u16(start, le);
    if (start + 2 + count * 12 > bytes.byteLength)
      return [] as { tag: number; type: number; count: number; value: number; entry: number }[];
    return Array.from({ length: count }, (_, i) => {
      const entry = start + 2 + i * 12;
      return {
        tag: u16(entry, le),
        type: u16(entry + 2, le),
        count: u32(entry + 4, le),
        value: u32(entry + 8, le),
        entry,
      };
    });
  };
  const parseExif = (tiff: number): string | undefined => {
    if (tiff + 8 > bytes.byteLength) return undefined;
    const order = ascii(tiff, 2);
    if (order !== 'II' && order !== 'MM') return undefined;
    const le = order === 'II';
    if (u16(tiff + 2, le) !== 42) return undefined;
    const ifd0 = readIfd(tiff, u32(tiff + 4, le), le);
    const exifPointer = ifd0.find((entry) => entry.tag === 0x8769);
    const exif = exifPointer ? readIfd(tiff, exifPointer.value, le) : [];
    const original = exif.find(
      (entry) => entry.tag === 0x9003 && entry.type === 2 && entry.count >= 19,
    );
    const legacy = ifd0.find(
      (entry) => entry.tag === 0x0132 && entry.type === 2 && entry.count >= 19,
    );
    const date = original ?? legacy;
    if (!date) return undefined;
    const dateOffset = date.count <= 4 ? date.entry + 8 : tiff + date.value;
    if (dateOffset + 19 > bytes.byteLength) return undefined;
    const raw = ascii(dateOffset, Math.min(date.count, 24)).replace(/\0.*$/, '').trim();
    const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw);
    if (!match) return undefined;
    const [, year, month, day, hour, minute, second] = match;
    const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return undefined;
    const parsed = new Date(time);
    return parsed.getUTCFullYear() === Number(year) &&
      parsed.getUTCMonth() + 1 === Number(month) &&
      parsed.getUTCDate() === Number(day) &&
      parsed.getUTCHours() === Number(hour) &&
      parsed.getUTCMinutes() === Number(minute) &&
      parsed.getUTCSeconds() === Number(second)
      ? iso
      : undefined;
  };

  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (u8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.byteLength && u8(offset) === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;
    const marker = u8(offset++);
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) break;
    const segmentLength = u16(offset, false);
    const segmentStart = offset + 2;
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) break;
    if (marker === 0xe1 && segmentLength >= 8 && ascii(segmentStart, 6) === 'Exif\0\0') {
      const result = parseExif(segmentStart + 6);
      if (result) return result;
    }
    offset += segmentLength;
  }
  return undefined;
}

export async function uploadPhoto(
  file: File | Blob,
  kind: PhotoKind,
  orderId?: string,
  onProgress?: (pct: number) => void,
): Promise<UploadResult> {
  const takenAt = await extractExifTakenAt(file);
  const blob = file instanceof File ? await compressImage(file) : file;
  const form = new FormData();
  form.append('kind', kind);
  if (takenAt) form.append('taken_at', takenAt);
  form.append('file', blob, 'photo.jpg');
  const path = orderId ? `/work-orders/${orderId}/photos` : '/photos';
  const { data } = await api.post(path, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // Таймаута нет осознанно: на рвущемся канале запрос может висеть;
    // прогресс виден, повтор/отмена — у пользователя. Дубликаты схлопываются
    // сервером по sha256 (replayed:true), зависший запрос вреда не наносит.
    timeout: 0,
    onUploadProgress: (e) => {
      if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return data;
}

/** Диагностика неуспешной загрузки: размер, длительность, код — для поля боя с каналом. */
export function describePhotoFailure(file: Blob, startedAt: number, err: unknown): string {
  const kb = Math.max(1, Math.round(file.size / 1024));
  const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  const status =
    err && typeof err === 'object' && 'response' in err
      ? String((err as { response?: { status?: unknown } }).response?.status ?? '')
      : '';
  const tech = [code, status && `HTTP ${status}`].filter(Boolean).join(' ');
  return `${kb} КБ / ${secs} с${tech ? ` [${tech}]` : ''}`;
}

export async function photoUrl(photoId: string): Promise<string> {
  const { data } = await api.get(`/photos/${photoId}/url`);
  return data.url;
}

export async function listOrderPhotos(orderId: string): Promise<UploadResult[]> {
  return readWithSnapshot(`work-order-photos:${orderId}`, async () => {
    const { data } = await api.get(`/work-orders/${orderId}/photos`);
    return Array.isArray(data) ? data : (data.items ?? data.data ?? []);
  });
}

export async function deletePhoto(photoId: string): Promise<void> {
  await api.delete(`/photos/${photoId}`);
}
