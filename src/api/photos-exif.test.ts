import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return { ...actual, api: apiMock };
});

import { extractExifTakenAt, uploadPhoto } from './photos';

function jpegWithExif(date: string, littleEndian = true): Blob {
  const tiff = new Uint8Array(64);
  const view = new DataView(tiff.buffer);
  const set16 = (offset: number, value: number) => view.setUint16(offset, value, littleEndian);
  const set32 = (offset: number, value: number) => view.setUint32(offset, value, littleEndian);
  tiff[0] = littleEndian ? 0x49 : 0x4d;
  tiff[1] = tiff[0];
  set16(2, 42);
  set32(4, 8);
  set16(8, 1);
  set16(10, 0x8769);
  set16(12, 4);
  set32(14, 1);
  set32(18, 26);
  set32(22, 0);
  set16(26, 1);
  set16(28, 0x9003);
  set16(30, 2);
  set32(32, 20);
  set32(36, 44);
  set32(40, 0);
  new TextEncoder().encode(`${date}\0`).forEach((byte, index) => {
    tiff[44 + index] = byte;
  });

  const jpeg = new Uint8Array(78);
  jpeg.set([0xff, 0xd8, 0xff, 0xe1]);
  new DataView(jpeg.buffer).setUint16(4, 72, false);
  jpeg.set(new TextEncoder().encode('Exif\0\0'), 6);
  jpeg.set(tiff, 12);
  jpeg.set([0xff, 0xd9], 76);
  return new Blob([jpeg], { type: 'image/jpeg' });
}

describe('extractExifTakenAt', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([true, false])('reads DateTimeOriginal with %s byte order', async (littleEndian) => {
    await expect(
      extractExifTakenAt(jpegWithExif('2026:10:13 12:34:56', littleEndian)),
    ).resolves.toBe('2026-10-13T12:34:56Z');
  });

  it('ignores invalid timestamps, non-JPEG input, and broken metadata without throwing', async () => {
    await expect(extractExifTakenAt(jpegWithExif('not-a-date'))).resolves.toBeUndefined();
    await expect(
      extractExifTakenAt(new Blob(['png data'], { type: 'image/png' })),
    ).resolves.toBeUndefined();
    await expect(
      extractExifTakenAt(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])])),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['2024:02:29 23:59:59', '2024-02-29T23:59:59Z'],
    ['2026:02:29 12:00:00', undefined],
    ['2026:13:01 00:00:00', undefined],
  ])('accepts only calendar-valid EXIF values (%s)', async (raw, expected) => {
    await expect(extractExifTakenAt(jpegWithExif(raw))).resolves.toBe(expected);
  });

  it('sends the original EXIF timestamp as metadata before image compression', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { id: 'photo-1' } });
    await uploadPhoto(jpegWithExif('2026:10:13 12:34:56'), 'after', 'order-1');
    const [, form] = apiMock.post.mock.calls[0] as [string, FormData];
    expect(form.get('taken_at')).toBe('2026-10-13T12:34:56Z');
    expect(form.get('kind')).toBe('after');
  });
});
