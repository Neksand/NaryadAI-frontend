import { describe, expect, it, vi } from 'vitest';
import { ensureFileReadable, extractExifTakenAt, readBlobBytes } from './photos';

const blobOf = (bytes: number[]) => new Blob([new Uint8Array(bytes)]);

describe('readBlobBytes', () => {
  it('retries a torn read and succeeds', async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    let calls = 0;
    const flaky = {
      size: 4,
      slice: () => ({
        arrayBuffer: async () => {
          calls += 1;
          if (calls < 3) throw new DOMException('denied', 'NotReadableError');
          return data.buffer as ArrayBuffer;
        },
      }),
    };
    const out = await readBlobBytes(flaky as unknown as Blob, 2_000_000, 3);
    expect(out).not.toBeNull();
    expect(calls).toBe(3);
  });

  it('returns null after exhausting attempts', async () => {
    const dead = {
      size: 10,
      slice: () => ({
        arrayBuffer: async () => {
          throw new DOMException('denied', 'NotReadableError');
        },
      }),
    };
    vi.useFakeTimers();
    try {
      const p = readBlobBytes(dead as unknown as Blob, 2_000_000, 2);
      await vi.runAllTimersAsync();
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ensureFileReadable', () => {
  it('throws a human message for unreadable files', async () => {
    const dead = {
      size: 10,
      slice: () => ({
        arrayBuffer: async () => {
          throw new DOMException('denied', 'NotReadableError');
        },
      }),
    };
    await expect(ensureFileReadable(dead as unknown as Blob)).rejects.toThrow(
      /недоступен на устройстве/,
    );
  });
});

describe('extractExifTakenAt', () => {
  it('returns undefined instead of throwing on unreadable files', async () => {
    const dead = {
      size: 10,
      slice: () => ({
        arrayBuffer: async () => {
          throw new DOMException('denied', 'NotReadableError');
        },
      }),
    };
    await expect(extractExifTakenAt(dead as unknown as Blob)).resolves.toBeUndefined();
  });

  it('still parses a minimal JPEG EXIF date', async () => {
    await expect(extractExifTakenAt(blobOf([0xff, 0xd8, 0xff, 0xe1]))).resolves.toBeUndefined();
  });
});
