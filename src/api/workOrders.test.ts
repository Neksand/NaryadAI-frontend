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
  createWorkOrder,
  getEquipmentHistory,
  getOrderEvents,
  getSimilarRepairs,
  getWorkOrder,
  listWorkOrders,
  myWorkOrders,
  orderAction,
  transitionOrder,
} from './workOrders';

const order = {
  id: 'o1',
  status: 'issued',
  priority: 'high',
  description: 'Течь масла',
  allowed_actions: ['accept'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listWorkOrders', () => {
  it('sends default limit 50', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { items: [order], next_cursor: null } });
    const out = await listWorkOrders();
    expect(apiMock.get).toHaveBeenCalledWith('/work-orders', { params: { limit: 50 } });
    expect(out.items).toHaveLength(1);
    expect(out.next_cursor).toBeNull();
  });

  it('skips empty filters, keeps cursor', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { items: [], next_cursor: 'c' } });
    await listWorkOrders({ status: '', overdue: true, limit: 20, cursor: 'c' });
    expect(apiMock.get).toHaveBeenCalledWith('/work-orders', {
      params: { limit: 20, overdue: true, cursor: 'c' },
    });
  });

  it('accepts plain arrays', async () => {
    apiMock.get.mockResolvedValueOnce({ data: [order] });
    const out = await listWorkOrders();
    expect(out).toEqual({ items: [order], next_cursor: null });
  });

  it('throws on unexpected shape', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { foo: 1 } });
    await expect(listWorkOrders()).rejects.toThrow('Unexpected /work-orders response shape');
  });

  it('rejects a page whose items violate the work-order schema', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: { items: [{ id: 'broken', status: 'issued' }], next_cursor: null },
    });
    await expect(listWorkOrders()).rejects.toThrow('Unexpected /work-orders response shape');
  });

  it('preserves false filter values while omitting empty filters', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { items: [], next_cursor: null } });
    await listWorkOrders({ status: 'issued', area_id: 'a1', overdue: false, cursor: '', q: '' });
    expect(apiMock.get).toHaveBeenCalledWith('/work-orders', {
      params: { limit: 50, status: 'issued', area_id: 'a1', overdue: false },
    });
  });
});

describe('myWorkOrders / getWorkOrder / events', () => {
  it('loads equipment history from its envelope and scopes the request to one equipment id', async () => {
    const history = [{ id: 'o-old', number: 7, status: 'closed', fault_code_id: 'f1' }];
    apiMock.get.mockResolvedValueOnce({ data: { items: history } });
    await expect(getEquipmentHistory('eq/one')).resolves.toEqual(history);
    expect(apiMock.get).toHaveBeenCalledWith('/equipment/eq%2Fone/history');
  });

  it('rejects a malformed equipment history envelope', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { rows: [] } });
    await expect(getEquipmentHistory('eq-malformed')).rejects.toThrow(
      'Unexpected equipment history response shape',
    );
  });

  it.each([
    ['active', '/work-orders/my/active'],
    ['history', '/work-orders/my/history'],
    ['all', '/work-orders/my'],
  ] as const)('scope %s hits %s', async (scope, path) => {
    apiMock.get.mockResolvedValueOnce({ data: [order] });
    await myWorkOrders(scope);
    expect(apiMock.get).toHaveBeenCalledWith(path);
  });

  it('unwraps items envelope', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { items: [order] } });
    await expect(myWorkOrders()).resolves.toHaveLength(1);
  });

  it('gets single order and events', async () => {
    apiMock.get.mockResolvedValueOnce({ data: order });
    await expect(getWorkOrder('o1')).resolves.toMatchObject({ id: 'o1' });
    apiMock.get.mockResolvedValueOnce({ data: { items: [{ action: 'accept' }] } });
    await expect(getOrderEvents('o1')).resolves.toEqual([{ action: 'accept' }]);
  });

  it('rejects a single-order response that violates the shared schema', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { id: 'o1', status: 'future-state' } });
    await expect(getWorkOrder('o1')).rejects.toThrow();
  });

  it('accepts bare event arrays from compatible servers', async () => {
    apiMock.get.mockResolvedValueOnce({ data: [{ action: 'issued' }] });
    await expect(getOrderEvents('o1')).resolves.toEqual([{ action: 'issued' }]);
  });

  it('rejects malformed order items in the worker list envelope', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { items: [{ id: 'broken', status: 'issued' }] } });
    await expect(myWorkOrders('active')).rejects.toThrow();
  });
});

describe('getSimilarRepairs', () => {
  it('requests ranked similar repairs and unwraps the envelope', async () => {
    const items = [
      { id: 'r1', number: 7, match_score: 0.9, match_reasons: ['тот же шифр неисправности'] },
    ];
    apiMock.get.mockResolvedValueOnce({ data: { equipment_id: 'e1', items } });
    await expect(getSimilarRepairs('e1')).resolves.toEqual(items);
    expect(apiMock.get).toHaveBeenCalledWith('/equipment/e1/similar-repairs', {
      params: { limit: 3 },
    });
  });

  it('passes the fault code and encodes the equipment id', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { items: [] } });
    await getSimilarRepairs('eq/one', { faultCodeId: 'f1', limit: 5 });
    expect(apiMock.get).toHaveBeenCalledWith('/equipment/eq%2Fone/similar-repairs', {
      params: { limit: 5, fault_code_id: 'f1' },
    });
  });

  it('rejects a malformed envelope', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { rows: [] } });
    await expect(getSimilarRepairs('e1')).rejects.toThrow(
      'Unexpected similar repairs response shape',
    );
  });
});

describe('createWorkOrder', () => {
  const input = {
    kind: 'unplanned',
    description: 'Гул',
    equipment_id: 'e1',
    assignee_id: 'w1',
    priority: 'high',
  };

  it.each([
    ['both assignee and crew', { ...input, crew_id: 'c1' }],
    ['neither assignee nor crew', { ...input, assignee_id: undefined }],
  ])('rejects invalid assignment (%s) locally', async (_label, invalidInput) => {
    await expect(createWorkOrder(invalidInput)).rejects.toThrow('XOR');
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('trims description and sends idempotency key', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { id: 'n1' } });
    await createWorkOrder({ ...input, description: '  Гул  ' }, 'key-1');
    const [, body, opts] = apiMock.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> },
    ];
    expect(body.description).toBe('Гул');
    expect(opts.headers['Idempotency-Key']).toBe('key-1');
  });

  it('throws on missing id', async () => {
    apiMock.post.mockResolvedValueOnce({ data: {} });
    await expect(createWorkOrder(input)).rejects.toThrow('Некорректный ответ');
  });
});

describe('transitions', () => {
  it('posts action with client_at and key', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { ok: true } });
    await transitionOrder('o1', 'accept', {}, 'k');
    const [path, body, opts] = apiMock.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> },
    ];
    expect(path).toBe('/work-orders/o1/transitions');
    expect(body.action).toBe('accept');
    expect(typeof body.client_at).toBe('string');
    expect(opts.headers['Idempotency-Key']).toBe('k');
  });

  it('extra fields cannot overwrite the requested action or client timestamp', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { ok: true } });
    await transitionOrder('o1', 'accept', { action: 'cancel', client_at: 'not-a-date' });
    const [, body] = apiMock.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.action).toBe('accept');
    expect(Number.isNaN(Date.parse(String(body.client_at)))).toBe(false);
  });

  it('orderAction uses per-action alias path', async () => {
    apiMock.post.mockResolvedValueOnce({ data: {} });
    await orderAction('o1', 'accept', {}, 'k2');
    expect(apiMock.post.mock.calls[0][0]).toBe('/work-orders/o1/accept');
  });
});
