// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTauri } from './is-tauri';

afterEach(() => {
  const w = window as unknown as Record<string, unknown>;
  delete w.__TAURI__;
  delete w.__TAURI_INTERNALS__;
  delete w.__TAURI_METADATA__;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('isTauri', () => {
  it('is false in a plain browser', () => {
    expect(isTauri()).toBe(false);
  });

  it('detects Tauri globals', () => {
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
    expect(isTauri()).toBe(true);
    delete (window as unknown as Record<string, unknown>).__TAURI__;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
  });

  it('detects Tauri user agent', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Tauri/2.0');
    expect(isTauri()).toBe(true);
  });

  it('ignores ordinary user agents', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh) Chrome/120');
    expect(isTauri()).toBe(false);
  });

  it('detects manual override flag', () => {
    localStorage.setItem('naryadai.tauri', '1');
    expect(isTauri()).toBe(true);
  });

  it('ignores other flag values', () => {
    localStorage.setItem('naryadai.tauri', '0');
    expect(isTauri()).toBe(false);
  });
});
