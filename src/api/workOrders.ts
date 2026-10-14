import { api, idempotencyHeaders } from '../lib/api-client';
import { normalizeOrderText, trimEdges } from '../lib/inputText';
import { readWithSnapshot } from '../lib/snapshot-cache';
import { PaginatedSchema, WorkOrderSchema, type WorkOrder } from '../types/domain';

export interface OrderFilters {
  status?: string;
  priority?: string;
  area_id?: string;
  equipment_id?: string;
  assignee_id?: string;
  overdue?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
  q?: string;
}

export async function listWorkOrders(
  f: OrderFilters = {},
): Promise<{ items: WorkOrder[]; next_cursor: string | null }> {
  return readWithSnapshot(`work-orders:${JSON.stringify(f)}`, async () => {
    const params: Record<string, unknown> = { limit: f.limit ?? 50 };
    for (const [k, v] of Object.entries(f)) {
      if (v === undefined || v === null || v === '') continue;
      if (k === 'cursor' && !v) continue;
      params[k] = v;
    }
    const { data } = await api.get('/work-orders', { params });
    const parsed = PaginatedSchema(WorkOrderSchema).safeParse(data);
    if (parsed.success)
      return { items: parsed.data.items, next_cursor: parsed.data.next_cursor ?? null };
    if (Array.isArray(data))
      return { items: WorkOrderSchema.array().parse(data), next_cursor: null };
    throw new Error('Unexpected /work-orders response shape');
  });
}

export async function myWorkOrders(
  scope: 'active' | 'history' | 'all' = 'active',
): Promise<WorkOrder[]> {
  return readWithSnapshot(`my-work-orders:${scope}`, async () => {
    const path =
      scope === 'active'
        ? '/work-orders/my/active'
        : scope === 'history'
          ? '/work-orders/my/history'
          : '/work-orders/my';
    const { data } = await api.get(path);
    const items = Array.isArray(data) ? data : (data.items ?? []);
    return WorkOrderSchema.array().parse(items);
  });
}

export async function getWorkOrder(id: string): Promise<WorkOrder> {
  return readWithSnapshot(`work-order:${id}`, async () => {
    const { data } = await api.get(`/work-orders/${id}`);
    return WorkOrderSchema.parse(data);
  });
}

export async function getOrderEvents(id: string): Promise<unknown[]> {
  return readWithSnapshot(`work-order-events:${id}`, async () => {
    const { data } = await api.get(`/work-orders/${id}/events`);
    return Array.isArray(data) ? data : (data.items ?? []);
  });
}

export interface EquipmentHistoryItem {
  id: string;
  number?: string | number;
  kind?: string;
  priority?: string;
  status?: string;
  issued_at?: string;
  closed_at?: string | null;
  description?: string;
  work_done_text?: string | null;
  fault_code_id?: string | null;
  fault_code?: string | null;
  fault_name?: string | null;
  fault_name_kk?: string | null;
  return_count?: number;
  equipment_stopped_at?: string | null;
  equipment_restored_at?: string | null;
}

export async function getEquipmentHistory(equipmentId: string): Promise<EquipmentHistoryItem[]> {
  return readWithSnapshot(`equipment-history:${equipmentId}`, async () => {
    const { data } = await api.get(`/equipment/${encodeURIComponent(equipmentId)}/history`);
    const items = Array.isArray(data) ? data : data?.items;
    if (!Array.isArray(items)) throw new Error('Unexpected equipment history response shape');
    return items as EquipmentHistoryItem[];
  });
}

export interface SimilarRepairItem extends EquipmentHistoryItem {
  materials?: { name: string; quantity: number; unit: string }[];
  duration_minutes?: number | null;
  norm_minutes?: number | null;
  match_score?: number;
  match_reasons?: string[];
}

/** Ranked "similar repairs" memory for issuance (same equipment, same fault first). */
export async function getSimilarRepairs(
  equipmentId: string,
  opts: { faultCodeId?: string; limit?: number } = {},
): Promise<SimilarRepairItem[]> {
  const params: Record<string, unknown> = { limit: opts.limit ?? 3 };
  if (opts.faultCodeId) params.fault_code_id = opts.faultCodeId;
  const { data } = await api.get(
    `/equipment/${encodeURIComponent(equipmentId)}/similar-repairs`,
    { params },
  );
  const items = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(items)) throw new Error('Unexpected similar repairs response shape');
  return items as SimilarRepairItem[];
}

export interface CreateOrderInput {
  kind: string;
  description: string;
  description_source?: string;
  area_id?: string;
  equipment_id?: string;
  assignee_id?: string;
  crew_id?: string;
  priority: string;
  due_at?: string;
  norm_minutes?: number;
  equipment_stopped?: boolean;
  comment?: string;
  photo_ids?: string[];
}

export async function createWorkOrder(
  input: CreateOrderInput,
  key?: string,
): Promise<{ id: string; number?: number; status?: string; replayed?: boolean }> {
  // Backend owns business state. Enforce XOR locally for a clear error before sending.
  const hasAssignee = Boolean(input.assignee_id);
  const hasCrew = Boolean(input.crew_id);
  if (hasAssignee === hasCrew) throw new Error('Укажите ровно исполнителя или бригаду (XOR)');
  // Нормализация до Idempotency-Key: пробелы по краям не должны плодить дубли.
  const clean = normalizeOrderText({ ...input, description: trimEdges(input.description ?? '') });
  // Бэкенд возвращает только {id, number, status} — полный наряд догружается отдельным GET.
  const { data } = await api.post('/work-orders', clean, { headers: idempotencyHeaders(key) });
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
  const cleanExtra = normalizeOrderText(extra);
  const { data } = await api.post(
    `/work-orders/${id}/transitions`,
    { ...cleanExtra, action, client_at: new Date().toISOString() },
    { headers: idempotencyHeaders(key) },
  );
  return data;
}

/** Per-action convenience (POST /work-orders/:id/{accept,...}) — same semantics as transitions. */
export async function orderAction(
  id: string,
  action: string,
  body: Record<string, unknown> = {},
  key?: string,
) {
  const { data } = await api.post(`/work-orders/${id}/${action}`, body, {
    headers: idempotencyHeaders(key),
  });
  return data;
}

export async function reviewDecision(
  id: string,
  decision: 'agree_ai' | 'override',
  score?: number,
  comment?: string,
  key?: string,
) {
  const { data } = await api.post(
    `/work-orders/${id}/review/decision`,
    { decision, score, comment },
    { headers: idempotencyHeaders(key) },
  );
  return data;
}

export async function addMaterials(
  id: string,
  items: { material_id: string; quantity: number }[],
  key?: string,
) {
  const { data } = await api.post(
    `/work-orders/${id}/materials`,
    { items },
    { headers: idempotencyHeaders(key) },
  );
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
