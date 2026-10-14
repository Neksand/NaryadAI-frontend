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

import {
  addMaterials,
  createWorkOrder,
  listWorkOrders,
  myWorkOrders,
  orderAction,
  reviewDecision,
  shiftBoard,
  shiftSummary,
  transitionOrder,
} from './workOrders';

const order = {
  id: 'o1',
  status: 'issued',
  priority: 'high',
  description: 'Течь',
  allowed_actions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reviewDecision / addMaterials', () => {
  it('posts decision with score, comment and key', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { ok: true } });
    await reviewDecision('o1', 'agree_ai', 90, 'норма', 'k1');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/work-orders/o1/review/decision',
      { decision: 'agree_ai', score: 90, comment: 'норма' },
      { headers: expect.objectContaining({ 'Idempotency-Key': 'k1' }) },
    );
  });

  it('posts override without score', async () => {
    apiMock.post.mockResolvedValueOnce({ data: {} });
    await reviewDecision('o1', 'override');
    const [, body] = apiMock.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.decision).toBe('override');
    expect(body.score).toBeUndefined();
  });

  it('posts materials list', async () => {
    apiMock.post.mockResolvedValueOnce({ data: {} });
    await addMaterials('o1', [{ material_id: 'm1', quantity: 2 }], 'k2');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/work-orders/o1/materials',
      { items: [{ material_id: 'm1', quantity: 2 }] },
      { headers: expect.objectContaining({ 'Idempotency-Key': 'k2' }) },
    );
  });
});

describe('shift endpoints', () => {
  it('passes board params through', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { counters: {} } });
    await shiftBoard({ area_id: 'a1' });
    expect(apiMock.get).toHaveBeenCalledWith('/shift/board', { params: { area_id: 'a1' } });
  });

  it('fetches summary', async () => {
    apiMock.get.mockResolvedValueOnce({ data: {} });
    await shiftSummary();
    expect(apiMock.get).toHaveBeenCalledWith('/shift/summary');
  });
});

describe('extra shapes', () => {
  it('orderAction passes body through untouched keys', async () => {
    apiMock.post.mockResolvedValueOnce({ data: {} });
    await orderAction('o1', 'reassign', { assignee_id: 'w9' }, 'k3');
    expect(apiMock.post).toHaveBeenCalledWith(
      '/work-orders/o1/reassign',
      { assignee_id: 'w9' },
      { headers: expect.objectContaining({ 'Idempotency-Key': 'k3' }) },
    );
  });

  it('transition trims extra comment', async () => {
    apiMock.post.mockResolvedValueOnce({ data: {} });
    await transitionOrder('o1', 'reject', { reason_code: 'sick', comment: '  устал  ' });
    const [, body] = apiMock.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.comment).toBe('устал');
  });

  it('create allows crew-only assignment', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { id: 'n1' } });
    await createWorkOrder({
      kind: 'planned',
      description: 'Осмотр',
      equipment_id: 'e1',
      crew_id: 'c1',
      priority: 'normal',
    });
    expect(apiMock.post).toHaveBeenCalled();
  });

  it('myWorkOrders without envelope resolves empty', async () => {
    apiMock.get.mockResolvedValueOnce({ data: {} });
    await expect(myWorkOrders()).resolves.toEqual([]);
  });

  it('listWorkOrders drops empty cursor but keeps zero limit', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { items: [order], next_cursor: null } });
    await listWorkOrders({ cursor: '', limit: 0 });
    expect(apiMock.get).toHaveBeenCalledWith('/work-orders', { params: { limit: 0 } });
  });
});
