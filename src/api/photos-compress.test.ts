import { describe, expect, it, vi } from 'vitest';
import { compressImage } from './photos';

const pngFile = () =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'a.png', { type: 'image/png' });

describe('compressImage fallback', () => {
  it('returns the original file when decoding throws (WebView quirk)', async () => {
    const file = pngFile();
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode fail')));
    await expect(compressImage(file)).resolves.toBe(file);
    vi.unstubAllGlobals();
  });

  it('returns the original file when canvas is unavailable', async () => {
    const file = pngFile();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }),
    );
    // Без DOM/canvas (или с null-контекстом) — тоже fallback на оригинал.
    await expect(compressImage(file)).resolves.toBe(file);
    vi.unstubAllGlobals();
  });
});
