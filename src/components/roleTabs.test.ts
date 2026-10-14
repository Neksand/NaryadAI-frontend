import { describe, expect, it } from 'vitest';
import { roleTabs } from './Shell';

const t = ((key: string) => key) as never;

describe('roleTabs', () => {
  it('worker sees orders, done and notifications', () => {
    expect(roleTabs(t, 'worker', 3).map((x) => x.to)).toEqual([
      '/worker',
      '/worker/history',
      '/notifications',
    ]);
    expect(roleTabs(t, 'worker', 3)[2].badge).toBe(3);
  });

  it('master sees shift and board', () => {
    expect(roleTabs(t, 'master').map((x) => x.to)).toEqual([
      '/master',
      '/master/board',
      '/notifications',
    ]);
  });

  it('manager and admin have two tabs', () => {
    expect(roleTabs(t, 'manager').map((x) => x.to)).toEqual(['/manager', '/notifications']);
    expect(roleTabs(t, 'admin').map((x) => x.to)).toEqual(['/admin', '/notifications']);
  });

  it('unknown role falls back to master tabs', () => {
    expect(roleTabs(t, null).map((x) => x.to)).toEqual([
      '/master',
      '/master/board',
      '/notifications',
    ]);
  });

  it('zero unread means no badge', () => {
    expect(roleTabs(t, 'worker', 0)[2].badge).toBeUndefined();
  });
});
