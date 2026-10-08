import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createWorkOrder } from '../api/workOrders';
import { suggestAssignee } from '../api/ai';
import { catalogList } from '../api/misc';
import { uploadPhoto } from '../api/photos';
import { Shell } from '../components/Shell';
import { VoiceButton } from '../components/VoiceButton';
import { AITag, ErrorState } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';

export default function MasterNew() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [form, setForm] = useState({ kind: 'unplanned', description: '', area_id: '', equipment_id: '', assignee_id: '', crew_id: '', priority: 'high', due_at: '', norm_minutes: 60, equipment_stopped: false });
  const [photoIds, setPhotoIds] = useState<string[]>([]);

  const areas = useQuery({ queryKey: ['catalog', 'sites'], queryFn: () => catalogList('sites') });
  const equipment = useQuery({ queryKey: ['catalog', 'equipment', form.area_id], queryFn: () => catalogList('equipment', form.area_id ? { area_id: form.area_id } : {}) });
  const workers = useQuery({ queryKey: ['workers'], queryFn: async () => {
    try { const { api } = await import('../lib/api-client'); const { data } = await api.get('/workers'); return Array.isArray(data) ? data : (data.items ?? data.data ?? []); }
    catch { return []; }
  } });

  const ai = useMutation({
    mutationFn: () => suggestAssignee({ area_id: form.area_id, equipment_id: form.equipment_id || undefined, priority: form.priority, description: form.description }),
  });

  const create = useMutation({
    mutationFn: () => createWorkOrder({
      // area_id бэкенд не принимает (участок выводится из оборудования) — только обязательные поля CreateWO.
      kind: form.kind, description: form.description.trim(),
      equipment_id: form.equipment_id, assignee_id: form.assignee_id || undefined,
      crew_id: form.crew_id || undefined, priority: form.priority,
      due_at: new Date(form.due_at).toISOString(),
      norm_minutes: form.norm_minutes, equipment_stopped: form.equipment_stopped, photo_ids: photoIds,
    }, crypto.randomUUID()),
    onSuccess: (order) => nav(`/master/orders/${order.id}`),
  });

  const canSubmit = form.equipment_id && form.due_at && form.description.trim().length >= 3 && !create.isPending;

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const err = create.isError ? toLocalizedError(create.error) : null;

  return (
    <Shell title={t('master.newOrder')} tabs={[{ to: '/master', label: t('master.shift') }]}>
      <div className="card flex flex-col gap-3">
        <label className="flex flex-col gap-1"><span className="label">{t('master.area')} *</span>
          <select className="input" value={form.area_id} onChange={(e) => set('area_id', e.target.value)} required>
            <option value="">—</option>
            {((areas.data ?? []) as { id: string; name: string }[]).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {!areas.isPending && (areas.data ?? []).length === 0 && (
          <div className="banner banner-warn" role="note">{t('master.noAreas')}</div>
        )}
        <label className="flex flex-col gap-1"><span className="label">{t('master.equipment')} *</span>
          <select className="input" value={form.equipment_id} onChange={(e) => set('equipment_id', e.target.value)} required>
            <option value="">—</option>
            {((equipment.data ?? []) as { id: string; name: string }[]).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1"><span className="label">{t('master.priority')}</span>
            <select className="input" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              <option value="critical">{t('priority.critical')}</option>
              <option value="high">{t('priority.high')}</option>
              <option value="normal">{t('priority.normal')}</option>
              <option value="planned">{t('priority.planned')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">{t('master.due')} *</span>
            <input className="input" type="datetime-local" value={form.due_at} onChange={(e) => set('due_at', e.target.value)} required />
          </label>
        </div>
        <label className="flex flex-col gap-1"><span className="label">{t('master.description')} * <VoiceButton onText={(txt) => set('description', (form.description ? form.description + ' ' : '') + txt)} /></span>
          <textarea className="input area" value={form.description} onChange={(e) => set('description', e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1"><span className="label">{t('master.assigneeHint')}</span>
          <select className="input" value={form.assignee_id} onChange={(e) => { set('assignee_id', e.target.value); if (e.target.value) set('crew_id', ''); }}>
            <option value="">—</option>
            {((workers.data ?? []) as { id: string; full_name?: string; name?: string }[]).map((w) => <option key={w.id} value={w.id}>{w.full_name ?? w.name ?? w.id}</option>)}
          </select>
        </label>
        {!workers.isPending && (workers.data ?? []).length === 0 && (
          <div className="banner banner-warn" role="note">{t('master.noWorkers')}</div>
        )}
        <div className="flex gap-2">
          <button className="btn btn-ai" disabled={!form.area_id || !form.description || ai.isPending} onClick={() => ai.mutate()}>✦ {t('ai.recommendation')}</button>
        </div>
        {ai.data && (
          <div className="flex flex-col gap-2">
            {(Array.isArray(ai.data) ? ai.data : (ai.data.candidates ?? ai.data.suggestions ?? ai.data.data ?? [])).slice(0, 3).map((c: { employee_id?: string; id?: string; full_name?: string; score?: number; confidence?: number; reasons?: string[]; explanation?: string }, i: number) => (
              <div key={i} className="card !p-3">
                <AITag confidence={c.score ?? c.confidence} explanation={(c.reasons ?? []).join('; ') || c.explanation || c.full_name} />
                <button className="btn btn-sm btn-ai mt-2" onClick={() => set('assignee_id', c.employee_id ?? c.id ?? '')}>{t('ai.apply')}</button>
              </div>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1"><span className="label">{t('master.beforePhoto')}</span>
          <input type="file" accept="image/*" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            const r = await uploadPhoto(f, 'before');
            setPhotoIds((p) => [...p, r.id]);
          }} />
          {photoIds.length > 0 && <span className="chip ok">{photoIds.length} ✓</span>}
        </label>
        {err && <ErrorState message={err.message} />}
        <button className="btn btn-primary btn-xl btn-block" disabled={!canSubmit} onClick={() => create.mutate()}>
          {create.isPending ? t('common.loading') : t('master.newOrder')}
        </button>
      </div>
    </Shell>
  );
}
