import { describe, expect, it } from 'vitest';
import {
  AIReviewSchema,
  ApiErrorSchema,
  NotificationSchema,
  PaginatedSchema,
  RoleSchema,
  UserSchema,
  WorkOrderSchema,
} from './domain';

const user = { id: 'u1', full_name: 'Мастер Участка', role: 'master' };
const order = { id: 'o1', status: 'issued', priority: 'high', description: 'Течь масла' };

describe('RoleSchema', () => {
  it.each(['worker', 'master', 'manager', 'admin'])('accepts role %s', (role) => {
    expect(RoleSchema.safeParse(role).success).toBe(true);
  });
  it('rejects unknown roles', () => {
    expect(RoleSchema.safeParse('boss').success).toBe(false);
    expect(RoleSchema.safeParse('').success).toBe(false);
  });
});

describe('UserSchema', () => {
  it('parses minimal user', () => {
    expect(UserSchema.parse(user)).toMatchObject({ ...user, area_ids: [] });
  });
  it('allows login null (backend /me quirk)', () => {
    expect(UserSchema.parse({ ...user, login: null }).login).toBeNull();
  });
  it('rejects bad role', () => {
    expect(UserSchema.safeParse({ ...user, role: 'boss' }).success).toBe(false);
  });
});

describe('WorkOrderSchema', () => {
  it('defaults allowed_actions to []', () => {
    expect(WorkOrderSchema.parse(order).allowed_actions).toEqual([]);
  });
  it('keeps unknown backend fields (passthrough)', () => {
    const parsed = WorkOrderSchema.parse({ ...order, area_name_kk: 'Учаске', custom: 1 });
    expect((parsed as Record<string, unknown>).custom).toBe(1);
  });
  it.each([
    'issued',
    'accepted',
    'queued',
    'rejected',
    'in_progress',
    'paused',
    'rework',
    'done',
    'ai_review',
    'closed',
    'cancelled',
  ] as const)('accepts work-order status %s', (status) => {
    expect(WorkOrderSchema.safeParse({ ...order, status }).success).toBe(true);
  });
  it.each(['critical', 'high', 'normal', 'planned'] as const)('accepts priority %s', (priority) => {
    expect(WorkOrderSchema.safeParse({ ...order, priority }).success).toBe(true);
  });
  it.each([
    ['status', { ...order, status: 'waiting' }],
    ['priority', { ...order, priority: 'urgent' }],
  ])('rejects unknown %s values', (_field, invalidOrder) => {
    expect(WorkOrderSchema.safeParse(invalidOrder).success).toBe(false);
  });
  it('rejects missing description', () => {
    expect(WorkOrderSchema.safeParse({ id: 'x', status: 'issued', priority: 'high' }).success).toBe(
      false,
    );
  });
});

describe('PaginatedSchema', () => {
  it('parses cursor pages', () => {
    const out = PaginatedSchema(WorkOrderSchema).parse({ items: [order], next_cursor: 'c1' });
    expect(out.items).toHaveLength(1);
    expect(out.next_cursor).toBe('c1');
  });
  it('allows missing cursor', () => {
    expect(PaginatedSchema(WorkOrderSchema).parse({ items: [] }).next_cursor).toBeFalsy();
  });
});

describe('ApiErrorSchema', () => {
  it('parses contract errors with request id', () => {
    const out = ApiErrorSchema.parse({
      error: { code: 'invalid_transition', message: 'Bad state', translation_key: 'error.x' },
      request_id: 'r9',
    });
    expect(out.request_id).toBe('r9');
    expect(out.error.code).toBe('invalid_transition');
  });
  it('rejects wrong shape', () => {
    expect(ApiErrorSchema.safeParse({ detail: 'x' }).success).toBe(false);
  });
});

describe('AIReviewSchema / NotificationSchema', () => {
  it('accepts empty review', () => {
    expect(AIReviewSchema.parse({}).verdict).toBeFalsy();
  });
  it.each(['accepted', 'accepted_with_remarks', 'needs_rework', 'needs_master_review'] as const)(
    'accepts AI verdict %s',
    (verdict) => {
      expect(AIReviewSchema.parse({ verdict }).verdict).toBe(verdict);
    },
  );
  it('rejects unknown AI verdicts', () => {
    expect(AIReviewSchema.safeParse({ verdict: 'maybe' }).success).toBe(false);
  });
  it('parses notifications with passthrough', () => {
    const n = NotificationSchema.parse({ id: 'n1', type: 'WORK_ORDER_ASSIGNED', extra: 1 });
    expect(n.type).toBe('WORK_ORDER_ASSIGNED');
    expect((n as Record<string, unknown>).extra).toBe(1);
  });
});
