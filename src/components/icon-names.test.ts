import { describe, expect, it } from 'vitest';
import { ICON_NAMES, type IconName } from './Icon';

const EXPECTED: IconName[] = [
  'orders',
  'history',
  'shift',
  'board',
  'analytics',
  'admin',
  'bell',
  'back',
  'arrowRight',
  'logout',
  'refresh',
  'chevD',
  'chevU',
  'chevL',
  'chevR',
  'camera',
  'calendar',
  'mic',
  'stop',
  'check',
  'checkAll',
  'clock',
  'spark',
  'close',
];

describe('Icon registry', () => {
  it('covers every icon used across screens', () => {
    expect([...ICON_NAMES].sort()).toEqual([...EXPECTED].sort());
  });

  it('has no duplicates', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });
});
