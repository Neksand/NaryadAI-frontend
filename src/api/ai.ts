import { api, idempotencyHeaders } from '../lib/api-client';
import { AIReviewSchema, type AIReview } from '../types/domain';

export async function suggestAssignee(input: { area_id: string; equipment_id?: string; priority?: string; description?: string }) {
  const { data } = await api.post('/ai/suggest-assignee', input);
  return data;
}

export async function suggestFaultCode(input: { description: string; equipment_id?: string }) {
  const { data } = await api.post('/ai/suggest-fault-code', input);
  return data;
}

export async function recommendWorker(orderId: string) {
  const { data } = await api.post(`/ai/work-orders/${orderId}/recommend-worker`, {});
  return data;
}

export async function inspectOrder(orderId: string) {
  const { data } = await api.post(`/ai/work-orders/${orderId}/inspect`, {});
  return data;
}

export async function getInspection(orderId: string): Promise<AIReview> {
  // FastAPI: /ai/work-orders/:id/inspection → {"data": {"job", "review"}} ; Node: /work-orders/:id/ai-review → {"ai_review"}
  const pick = (d: unknown) => {
    if (d && typeof d === 'object') {
      const o = d as Record<string, unknown>;
      const inner = (o.data ?? o) as Record<string, unknown>;
      const review = (inner.review ?? inner.ai_review ?? inner) as unknown;
      return review;
    }
    return d;
  };
  try {
    const { data } = await api.get(`/ai/work-orders/${orderId}/inspection`);
    return AIReviewSchema.passthrough().parse(pick(data));
  } catch {
    const { data } = await api.get(`/work-orders/${orderId}/ai-review`);
    return AIReviewSchema.passthrough().parse(pick(data));
  }
}

export async function aiInsights(params: Record<string, string> = {}) {
  const { data } = await api.get('/ai/insights', { params });
  return data;
}

export async function transcribeAudio(file: Blob, workOrderId?: string) {
  const form = new FormData();
  form.append('file', file, 'voice.webm');
  if (workOrderId) form.append('work_order_id', workOrderId);
  const { data } = await api.post('/ai/transcribe', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
  // Бэкенд отдаёт {transcript, ...}, фронт ждёт {text, confidence}
  return { text: (data.transcript ?? data.text ?? '') as string, confidence: data.confidence as number | undefined };
}

export async function planOrderFromInsight(insightId: string, input: { assignee_id?: string; crew_id?: string; due_at: string }, key?: string) {
  const { data } = await api.post(`/analytics/insights/${insightId}/plan-order`, input, { headers: idempotencyHeaders(key) });
  return data;
}
