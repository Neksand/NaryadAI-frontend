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
  analyticsGet,
  catalogList,
  createEmployee,
  deleteDict,
  dictCreate,
  dictList,
  exportReport,
  exportStatus,
  listNotifications,
  markAllRead,
  markRead,
  patchDict,
  resetPin,
  unblockUser,
} from './misc';
import {
  getInspection,
  planOrderFromInsight,
  suggestAssignee,
  suggestFaultCode,
  transcribeAudio,
} from './ai';
import { listOrderPhotos, photoUrl, uploadPhoto } from './photos';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('misc: notifications', () => {
  const n = { id: 'n1', type: 'WORK_ORDER_ASSIGNED', title: 'Назначен', is_read: false };

  it('unwraps data envelope', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { data: [n], unread: 1 } });
    await expect(listNotifications(true)).resolves.toEqual([expect.objectContaining({ id: 'n1' })]);
    expect(apiMock.get).toHaveBeenCalledWith('/notifications', {
      params: { unread_only: true, limit: 50 },
    });
  });

  it('accepts plain arrays', async () => {
    apiMock.get.mockResolvedValueOnce({ data: [n] });
    await expect(listNotifications()).resolves.toHaveLength(1);
  });

  it('marks read and read-all', async () => {
    apiMock.post.mockResolvedValue({ data: {} });
    await markRead('n1');
    expect(apiMock.post).toHaveBeenCalledWith('/notifications/n1/read', {});
    await markAllRead();
    expect(apiMock.post).toHaveBeenCalledWith('/notifications/read-all', {});
  });
});

describe('misc: catalogs and dicts', () => {
  it('catalogList handles all envelopes', async () => {
    apiMock.get.mockResolvedValueOnce({ data: [{ id: 'a' }] });
    await expect(catalogList('sites')).resolves.toEqual([{ id: 'a' }]);
    apiMock.get.mockResolvedValueOnce({ data: { items: [{ id: 'b' }] } });
    await expect(catalogList('sites')).resolves.toEqual([{ id: 'b' }]);
    apiMock.get.mockResolvedValueOnce({ data: { data: [{ id: 'c' }] } });
    await expect(catalogList('sites')).resolves.toEqual([{ id: 'c' }]);
    apiMock.get.mockResolvedValueOnce({ data: {} });
    await expect(catalogList('sites')).resolves.toEqual([]);
  });

  it('dictList unwraps items', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { items: [1] } });
    await expect(dictList('reasons', { kind: 'reject' })).resolves.toEqual([1]);
    expect(apiMock.get).toHaveBeenCalledWith('/dict/reasons', { params: { kind: 'reject' } });
  });

  it('creates, patches, deletes', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { id: 'x' } });
    await dictCreate('areas', { name: 'A' });
    expect(apiMock.post).toHaveBeenCalledWith('/dict/areas', { name: 'A' });
    apiMock.post.mockResolvedValueOnce({ data: { id: 'e1' } });
    await expect(
      createEmployee({ login: 'w16', pin: '1001', full_name: 'Работник', role: 'worker' }),
    ).resolves.toEqual({ id: 'e1' });
    apiMock.patch.mockResolvedValueOnce({ data: {} });
    await patchDict('employees', 'e1', { full_name: 'Новое' });
    expect(apiMock.patch).toHaveBeenCalledWith('/dict/employees/e1', { full_name: 'Новое' });
    apiMock.delete.mockResolvedValueOnce({ data: {} });
    await deleteDict('employees', 'e1');
    expect(apiMock.delete).toHaveBeenCalledWith('/dict/employees/e1');
  });

  it('resets pin and unblocks', async () => {
    apiMock.post.mockResolvedValue({ data: {} });
    await resetPin('u1', '4321');
    expect(apiMock.post).toHaveBeenCalledWith('/users/u1/reset-pin', { pin: '4321' });
    await unblockUser('u1');
    expect(apiMock.post).toHaveBeenCalledWith('/users/u1/unblock', {});
  });

  it('exports reports with idempotency key', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { job_id: 'j1' } });
    await expect(exportReport({ type: 'orders', format: 'pdf' })).resolves.toEqual({
      job_id: 'j1',
    });
    const opts = apiMock.post.mock.calls[0][2] as { headers: Record<string, string> };
    expect(typeof opts.headers['Idempotency-Key']).toBe('string');
    apiMock.get.mockResolvedValueOnce({ data: { status: 'done', signed_url: 'https://x' } });
    await expect(exportStatus('j1')).resolves.toMatchObject({ status: 'done' });
  });
});

describe('ai', () => {
  it('suggests assignee and fault code', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { candidates: [] } });
    await suggestAssignee({ area_id: 'a1', priority: 'high', description: 'x' });
    expect(apiMock.post).toHaveBeenCalledWith('/ai/suggest-assignee', {
      area_id: 'a1',
      priority: 'high',
      description: 'x',
    });
    apiMock.post.mockResolvedValueOnce({ data: {} });
    await suggestFaultCode({ description: 'гул' });
    expect(apiMock.post).toHaveBeenCalledWith('/ai/suggest-fault-code', { description: 'гул' });
  });

  it('getInspection unwraps review envelopes', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: { data: { review: { verdict: 'accepted', score: 90 } } },
    });
    await expect(getInspection('o1')).resolves.toMatchObject({ verdict: 'accepted' });
    apiMock.get.mockRejectedValueOnce(new Error('nope'));
    apiMock.get.mockResolvedValueOnce({ data: { ai_review: { verdict: 'needs_rework' } } });
    await expect(getInspection('o1')).resolves.toMatchObject({ verdict: 'needs_rework' });
  });

  it('transcribeAudio sends WAV, Kazakh language and a long local-model timeout', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: { transcript: 'заменил подшипник', confidence: 0.9 },
    });
    const out = await transcribeAudio(new Blob(['x']), 'o1', 'kk');
    expect(out).toEqual({ text: 'заменил подшипник', confidence: 0.9, pending: false });
    const [, form, options] = apiMock.post.mock.calls[0] as [string, FormData, { timeout: number }];
    expect(form.get('work_order_id')).toBe('o1');
    expect(form.get('language')).toBe('kk');
    expect((form.get('file') as File).name).toBe('voice.wav');
    expect(options.timeout).toBe(300_000);
  });

  it('normalizes unsupported speech languages to Russian and preserves pending state', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { transcript: null, pending: true } });
    const out = await transcribeAudio(new Blob(['x']), undefined, 'kz');
    expect(out).toEqual({ text: '', confidence: undefined, pending: true });
    const [, form] = apiMock.post.mock.calls[0] as [string, FormData];
    expect(form.get('work_order_id')).toBeNull();
    expect(form.get('language')).toBe('ru');
  });

  it('plans order from insight with key', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { id: 'n1' } });
    await planOrderFromInsight('i1', { assignee_id: 'w1', due_at: 'x' }, 'k');
    const [path, , opts] = apiMock.post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];
    expect(path).toBe('/analytics/insights/i1/plan-order');
    expect(opts.headers['Idempotency-Key']).toBe('k');
  });
});

describe('photos', () => {
  it('uploads to order path with kind', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { id: 'p1' } });
    const out = await uploadPhoto(new Blob(['img']), 'after', 'o1', () => {});
    expect(out).toEqual({ id: 'p1' });
    const [path, form] = apiMock.post.mock.calls[0] as [string, FormData];
    expect(path).toBe('/work-orders/o1/photos');
    expect(form.get('kind')).toBe('after');
  });

  it('uploads standalone before-photos to /photos', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { id: 'p2' } });
    await uploadPhoto(new Blob(['img']), 'before');
    expect(apiMock.post.mock.calls[0][0]).toBe('/photos');
  });

  it('resolves signed urls and reports photo-list failures when no snapshot is available', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { url: 'https://signed' } });
    await expect(photoUrl('p1')).resolves.toBe('https://signed');
    apiMock.get.mockRejectedValueOnce(new Error('down'));
    await expect(listOrderPhotos('o1')).rejects.toThrow('down');
  });
});

describe('analyticsGet', () => {
  it('passes path and params', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { kpis: {} } });
    await analyticsGet('dashboard', { shift: '1' });
    expect(apiMock.get).toHaveBeenCalledWith('/analytics/dashboard', { params: { shift: '1' } });
  });
});
