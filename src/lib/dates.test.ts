import { describe, expect, it } from 'vitest';
import { formatD, formatDT } from './dates';

describe('dates', () => {
  it('formats as dd.mm.yyyy, hh:mm', () => {
    expect(formatDT('2026-10-12T09:05:00')).toBe('12.10.2026, 09:05');
    expect(formatDT('2026-10-12T09:05:00', 'kk')).toBe('12.10.2026, 09:05');
    expect(formatD('2026-01-02T03:04:00')).toBe('02.01.2026');
  });

  it('returns empty on bad input', () => {
    expect(formatDT(null)).toBe('');
    expect(formatDT('not-a-date')).toBe('');
    expect(formatDT(undefined)).toBe('');
    expect(formatDT('')).toBe('');
    expect(formatDT(NaN)).toBe('');
  });

  it('accepts Date objects and timestamps', () => {
    const d = new Date(2026, 4, 9, 7, 3);
    expect(formatDT(d)).toBe('09.05.2026, 07:03');
    expect(formatDT(d.getTime())).toBe('09.05.2026, 07:03');
  });

  it('pads single digits', () => {
    expect(formatDT('2026-01-02T03:04:00')).toBe('02.01.2026, 03:04');
  });

  it('formatD cuts the time part', () => {
    expect(formatD('2026-10-12T09:05:00')).toBe('12.10.2026');
    expect(formatD(null)).toBe('');
    expect(formatD('garbage')).toBe('');
  });
});
