import { describe, expect, it } from 'vitest';
import { deadlineState, urgencyCompare } from './deadline';

describe('worker deadline presentation and prioritization', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');

  it('formats time remaining and overdue duration with rounding up to a minute', () => {
    expect(deadlineState('2026-10-13T12:00:30Z', now)).toEqual({
      kind: 'remaining',
      days: 0,
      hours: 0,
      minutes: 1,
    });
    expect(deadlineState('2026-10-15T14:05:00Z', now)).toEqual({
      kind: 'remaining',
      days: 2,
      hours: 2,
      minutes: 5,
    });
    expect(deadlineState('2026-10-13T11:29:00Z', now)).toEqual({
      kind: 'overdue',
      days: 0,
      hours: 0,
      minutes: 31,
    });
    expect(deadlineState('invalid', now)).toEqual({ kind: 'none' });
    expect(deadlineState(undefined, now)).toEqual({ kind: 'none' });
  });

  it('sorts overdue and higher-priority work before ordinary work, then nearest deadline', () => {
    const orders = [
      { id: 'later', priority: 'normal', due_at: '2026-10-13T18:00:00Z' },
      { id: 'critical', priority: 'critical', due_at: '2026-10-15T12:00:00Z' },
      { id: 'overdue', priority: 'normal', due_at: '2026-10-13T11:00:00Z' },
      { id: 'soon', priority: 'normal', due_at: '2026-10-13T13:00:00Z' },
    ];
    expect(orders.sort((a, b) => urgencyCompare(a, b, now)).map((o) => o.id)).toEqual([
      'overdue',
      'critical',
      'soon',
      'later',
    ]);
  });
});
