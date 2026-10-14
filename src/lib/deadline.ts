export type DeadlineState =
  | { kind: 'remaining'; days: number; hours: number; minutes: number }
  | { kind: 'overdue'; days: number; hours: number; minutes: number }
  | { kind: 'none' };

export function deadlineState(dueAt: string | null | undefined, now = Date.now()): DeadlineState {
  if (!dueAt) return { kind: 'none' };
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return { kind: 'none' };
  const delta = Math.abs(due - now);
  const minutesTotal = Math.max(1, Math.ceil(delta / 60_000));
  const days = Math.floor(minutesTotal / 1440);
  const hours = Math.floor((minutesTotal % 1440) / 60);
  const minutes = minutesTotal % 60;
  return { kind: due <= now ? 'overdue' : 'remaining', days, hours, minutes };
}

export function urgencyCompare(
  a: { priority: string; due_at?: string | null; is_overdue?: boolean },
  b: { priority: string; due_at?: string | null; is_overdue?: boolean },
  now = Date.now(),
): number {
  const priorityScore: Record<string, number> = { critical: 0, high: 1, normal: 2, planned: 3 };
  const overdue = (order: typeof a) =>
    order.is_overdue || Boolean(order.due_at && Date.parse(order.due_at) <= now);
  const urgentDelta = Number(overdue(b)) - Number(overdue(a));
  if (urgentDelta) return urgentDelta;
  const pDelta = (priorityScore[a.priority] ?? 4) - (priorityScore[b.priority] ?? 4);
  if (pDelta) return pDelta;
  const aParsed = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
  const bParsed = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
  const aDue = Number.isFinite(aParsed) ? aParsed : Number.POSITIVE_INFINITY;
  const bDue = Number.isFinite(bParsed) ? bParsed : Number.POSITIVE_INFINITY;
  return aDue - bDue;
}
