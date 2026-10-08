import { api } from '../lib/api-client';
import { NotificationSchema, type AppNotification } from '../types/domain';

export async function listNotifications(unreadOnly = false, limit = 50): Promise<AppNotification[]> {
  const { data } = await api.get('/notifications', { params: { unread_only: unreadOnly || undefined, limit } });
  // Бэкенд отдаёт {"data": [...], "unread": n}
  const items = Array.isArray(data) ? data : (data.items ?? data.data ?? []);
  return NotificationSchema.array().parse(items);
}

export async function markRead(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`, {});
}

export async function markAllRead(): Promise<void> {
  await api.post('/notifications/read-all', {});
}

export async function analyticsGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const { data } = await api.get(`/analytics/${path}`, { params });
  return data;
}

export async function catalogList(name: 'sites' | 'teams' | 'equipment' | 'materials' | 'fault-codes', params: Record<string, string> = {}): Promise<unknown[]> {
  const { data } = await api.get(`/${name}`, { params });
  // Каталоги-алиасы отдают {"data": [...]}, /dict/* — {"items": [...]}, бывает и голый массив.
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export async function dictList(type: string, params: Record<string, string> = {}): Promise<unknown[]> {
  const { data } = await api.get(`/dict/${type}`, { params });
  return Array.isArray(data) ? data : (data.items ?? []);
}

export async function dictCreate(type: string, body: Record<string, unknown>): Promise<unknown> {
  const { data } = await api.post(`/dict/${type}`, body);
  return data;
}

export interface CreateEmployeeInput {
  login: string;
  pin: string;
  full_name: string;
  role: 'worker' | 'master' | 'manager' | 'admin';
  crew_id?: string;
  shift?: string;
  area_ids?: string[];
}

export async function createEmployee(body: CreateEmployeeInput): Promise<{ id: string }> {
  const { data } = await api.post('/dict/employees', body);
  return data;
}

export async function resetPin(userId: string, pin: string): Promise<void> {
  await api.post(`/users/${userId}/reset-pin`, { pin });
}

export async function patchDict(type: string, id: string, body: Record<string, unknown>): Promise<void> {
  await api.patch(`/dict/${type}/${id}`, body);
}

export async function deleteDict(type: string, id: string): Promise<void> {
  await api.delete(`/dict/${type}/${id}`);
}

export async function unblockUser(userId: string): Promise<void> {
  await api.post(`/users/${userId}/unblock`, {});
}

export async function exportReport(body: { type: string; format: 'pdf' | 'xlsx'; filters?: Record<string, unknown> }) {
  const { data } = await api.post('/reports/export', body, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
  return data as { job_id: string };
}

export async function exportStatus(jobId: string) {
  const { data } = await api.get(`/reports/export/${jobId}`);
  return data as { status: string; signed_url?: string; url?: string };
}
