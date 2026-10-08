import { api, idempotencyHeaders } from '../lib/api-client';
import { PaginatedSchema, WorkOrderSchema, type WorkOrder } from '../types/domain';

export interface OrderFilters {
  status?: string; priority?: string; area_id?: string; equipment_id?: string;
  assignee_id?: string; overdue?: boolean; from?: string; to?: string;
  limit?: number; cursor?: string | null; q?: string;
}

export async function listWorkOrders(f: OrderFilters = {}): Promise<{ items: WorkOrder[]; next_cursor: string | null }> {
  const params: Record<string, unknown> = { limit: f.limit ?? 50 };
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'cursor' && !v) continue;
    params[k] = v;
  }
  const { data } = await api.get('/work-orders', { params });
  const parsed = PaginatedSchema(WorkOrderSchema).safeParse(data);
  if (parsed.success) return { items: parsed.data.items, next_cursor: parsed.data.next_cursor ?? null };
  // Fallback: plain array
  if (Array.isArray(data)) return { items: WorkOrderSchema.array().parse(data), next_cursor: null };
  throw new Error('Unexpected /work-orders response shape');
}

export async function myWorkOrders(scope: 'active' | 'history' | 'all' = 'active'): Promise<WorkOrder[]> {
  const path = scope === 'active' ? '/work-orders/my/active' : scope === 'history' ? '/work-orders/my/history' : '/work-orders/my';
  const { data } = await api.get(path);
  const items = Array.isArray(data) ? data : (data.items ?? []);
  return WorkOrderSchema.array().parse(items);
}

export async function getWorkOrder(id: string): Promise<WorkOrder> {
  const { data } = await api.get(`/work-orders/${id}`);
  return WorkOrderSchema.parse(data);
}

export async function getOrderEvents(id: string): Promise<unknown[]> {
  const { data } = await api.get(`/work-orders/${id}/events`);
  return Array.isArray(data) ? data : (data.items ?? []);
}

export interface CreateOrderInput {
  kind: string; description: string; description_source?: string;
  area_id?: string; equipment_id?: string;
  assignee_id?: string; crew_id?: string;
  priority: string; due_at?: string; norm_minutes?: number;
  equipment_stopped?: boolean; comment?: string; photo_ids?: string[];
}

export async function createWorkOrder(input: CreateOrderInput, key?: string): Promise<{ id: string; number?: number; status?: string; replayed?: boolean }> {
  // Backend owns business state. Enforce XOR locally for a clear error before sending.
  if (input.assignee_id && input.crew_id) throw new Error('Укажите либо исполнителя, либо бригаду (XOR)');
  // Бэкенд возвращает только {id, number, status} — полный наряд догружается отдельным GET.
  const { data } = await api.post('/work-orders', input, { headers: idempotencyHeaders(key) });
  if (!data?.id) throw new Error('Некорректный ответ сервера');
  return data;
}

/** Generic transition — preferred path. Per-action aliases delegate to the same backend transition(). */
export async function transitionOrder(
  id: string,
  action: string,
  extra: Record<string, unknown> = {},
  key?: string,
) {
  const { data } = await api.post(
    `/work-orders/${id}/transitions`,
    { action, client_at: new Date().toISOString(), ...extra },
    { headers: idempotencyHeaders(key) },
  );
  return data;
}

/** Per-action convenience (POST /work-orders/:id/{accept,...}) — same semantics as transitions. */
export async function orderAction(id: string, action: string, body: Record<string, unknown> = {}, key?: string) {
  const { data } = await api.post(`/work-orders/${id}/${action}`, body, { headers: idempotencyHeaders(key) });
  return data;
}

export async function reviewDecision(id: string, decision: 'agree_ai' | 'override', score?: number, comment?: string, key?: string) {
  const { data } = await api.post(
    `/work-orders/${id}/review/decision`,
    { decision, score, comment },
    { headers: idempotencyHeaders(key) },
  );
  return data;
}

export async function addMaterials(id: string, items: { material_id: string; quantity: number }[], key?: string) {
  const { data } = await api.post(`/work-orders/${id}/materials`, { items }, { headers: idempotencyHeaders(key) });
  return data;
}

export async function shiftBoard(params: Record<string, string> = {}) {
  const { data } = await api.get('/shift/board', { params });
  return data;
}

export async function shiftSummary() {
  const { data } = await api.get('/shift/summary');
  return data;
}
