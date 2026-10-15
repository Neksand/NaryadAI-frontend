import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createWorkOrder, getSimilarRepairs } from '../api/workOrders';
import { suggestAssignee } from '../api/ai';
import { catalogList } from '../api/misc';
import { uploadPhoto } from '../api/photos';
import { Shell, roleTabs } from '../components/Shell';
import { VoiceButton } from '../components/VoiceButton';
import { DateTimeField } from '../components/DateTimeField';
import { AITag, ErrorState } from '../components/ui';
import { toLocalizedError, newUUID } from '../lib/api-client';
import { pickName } from '../lib/names';
import { Icon } from '../components/Icon';

export default function MasterNew() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'ru').slice(0, 2);
  const nav = useNavigate();
  const [form, setForm] = useState({
    kind: 'unplanned',
    description: '',
    area_id: '',
    equipment_id: '',
    assignee_id: '',
    crew_id: '',
    priority: 'high',
    due_at: '',
    norm_minutes: 60,
    equipment_stopped: false,
    comment: '',
  });
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const areas = useQuery({ queryKey: ['catalog', 'sites'], queryFn: () => catalogList('sites') });
  const equipment = useQuery({
    queryKey: ['catalog', 'equipment', form.area_id],
    queryFn: () => catalogList('equipment', form.area_id ? { area_id: form.area_id } : {}),
  });
  const workers = useQuery({
    queryKey: ['workers'],
    queryFn: async () => {
      try {
        const { api } = await import('../lib/api-client');
        const { data } = await api.get('/workers');
        return Array.isArray(data) ? data : (data.items ?? data.data ?? []);
      } catch {
        return [];
      }
    },
  });
  const crews = useQuery({ queryKey: ['catalog', 'teams'], queryFn: () => catalogList('teams') });
  const similar = useQuery({
    queryKey: ['similar-repairs', form.equipment_id],
    queryFn: () => getSimilarRepairs(form.equipment_id, { limit: 3 }),
    enabled: Boolean(form.equipment_id),
  });

  const ai = useMutation({
    mutationFn: () =>
      suggestAssignee({
        area_id: form.area_id,
        equipment_id: form.equipment_id || undefined,
        priority: form.priority,
        description: form.description,
      }),
  });

  const create = useMutation({
    mutationFn: () =>
      createWorkOrder(
        {
          // area_id бэкенд не принимает (участок выводится из оборудования) — только обязательные поля CreateWO.
          // due_at уже ISO из DateTimeField (дд.мм.гггг, чч:мм), повторно не парсим.
          kind: form.kind,
          description: form.description.trim(),
          equipment_id: form.equipment_id,
          assignee_id: form.assignee_id || undefined,
          crew_id: form.crew_id || undefined,
          priority: form.priority,
          due_at: form.due_at,
          norm_minutes: form.norm_minutes,
          equipment_stopped: form.equipment_stopped,
          photo_ids: photoIds,
          comment: form.comment.trim() || undefined,
        },
        newUUID(),
      ),
    onSuccess: (order) => nav(`/master/orders/${order.id}`),
  });

  const canSubmit =
    form.equipment_id &&
    form.due_at &&
    form.description.trim().length >= 3 &&
    (form.assignee_id || form.crew_id) &&
    !create.isPending &&
    !uploadingPhoto;

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const err = create.isError ? toLocalizedError(create.error) : null;

  return (
    <Shell title={t('master.newOrder')} tabs={roleTabs(t, 'master')}>
      <div className="card flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('master.kind')}>
          {(['planned', 'unplanned'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={form.kind === k}
              className={`btn ${form.kind === k ? 'btn-primary' : ''}`}
              onClick={() => set('kind', k)}
            >
              {t(`kind.${k}`, k === 'planned' ? 'Плановый' : 'Внеплановый')}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className="label">{t('master.area')} *</span>
          <select
            className="input"
            value={form.area_id}
            onChange={(e) => set('area_id', e.target.value)}
            required
          >
            <option value="">—</option>
            {((areas.data ?? []) as { id: string; name: string; name_kk?: string }[]).map((a) => (
              <option key={a.id} value={a.id}>
                {pickName(a, lang) || a.name}
              </option>
            ))}
          </select>
        </label>
        {!areas.isPending && (areas.data ?? []).length === 0 && (
          <div className="banner banner-warn" role="note">
            {t('master.noAreas')}
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="label">{t('master.equipment')} *</span>
          <select
            className="input"
            value={form.equipment_id}
            onChange={(e) => set('equipment_id', e.target.value)}
            required
          >
            <option value="">—</option>
            {((equipment.data ?? []) as { id: string; name: string; name_kk?: string }[]).map(
              (e) => (
                <option key={e.id} value={e.id}>
                  {pickName(e, lang) || e.name}
                </option>
              ),
            )}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">{t('master.priority')}</span>
            <select
              className="input"
              value={form.priority}
              onChange={(e) => set('priority', e.target.value)}
            >
              <option value="critical">{t('priority.critical')}</option>
              <option value="high">{t('priority.high')}</option>
              <option value="normal">{t('priority.normal')}</option>
              <option value="planned">{t('priority.planned')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">{t('master.due')} *</span>
            <DateTimeField value={form.due_at} onChange={(iso) => set('due_at', iso)} required />
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <div className="label">
            <label htmlFor="order-description">{t('master.description')} *</label>{' '}
            <VoiceButton
              onText={(txt) =>
                set('description', (form.description ? form.description + ' ' : '') + txt)
              }
            />
          </div>
          <textarea
            id="order-description"
            className="input area"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            required
            maxLength={4000}
          />
        </div>
        <label className="flex flex-col gap-1">
          <span className="label">{t('master.assigneeHint')}</span>
          <select
            className="input"
            value={form.assignee_id}
            onChange={(e) => {
              set('assignee_id', e.target.value);
              if (e.target.value) set('crew_id', '');
            }}
          >
            <option value="">—</option>
            {(
              (workers.data ?? []) as {
                id: string;
                full_name?: string;
                name?: string;
                current_status?: string;
              }[]
            ).map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name ?? w.name ?? w.id}
                {w.current_status
                  ? ` · ${t(`empStatus.${w.current_status}`, w.current_status)}`
                  : ''}
              </option>
            ))}
          </select>
        </label>
        {!workers.isPending && (workers.data ?? []).length === 0 && (
          <div className="banner banner-warn" role="note">
            {t('master.noWorkers')}
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="label">
            {t('master.crew')} ({t('common.or')})
          </span>
          <select
            className="input"
            value={form.crew_id}
            onChange={(e) => {
              set('crew_id', e.target.value);
              if (e.target.value) set('assignee_id', '');
            }}
          >
            <option value="">—</option>
            {((crews.data ?? []) as { id: string; name?: string; name_kk?: string }[]).map((c) => (
              <option key={c.id} value={c.id}>
                {pickName(c, lang) || c.name || c.id}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            className="btn btn-ai"
            disabled={!form.area_id || !form.description || ai.isPending}
            onClick={() => ai.mutate()}
          >
            <Icon name="spark" size={18} /> {t('ai.recommendation')}
          </button>
        </div>
        {ai.data && (
          <div className="flex flex-col gap-2">
            {(Array.isArray(ai.data)
              ? ai.data
              : (ai.data.candidates ?? ai.data.suggestions ?? ai.data.data ?? [])
            )
              .slice(0, 3)
              .map(
                (
                  c: {
                    employee_id?: string;
                    id?: string;
                    full_name?: string;
                    score?: number;
                    confidence?: number;
                    reasons?: string[];
                    explanation?: string;
                  },
                  i: number,
                ) => (
                  <div key={i} className="card !p-3">
                    <AITag
                      confidence={c.score ?? c.confidence}
                      explanation={(c.reasons ?? []).join('; ') || c.explanation || c.full_name}
                    />
                    <button
                      className="btn btn-sm btn-ai mt-2"
                      onClick={() => {
                        set('assignee_id', c.employee_id ?? c.id ?? '');
                        set('crew_id', '');
                      }}
                    >
                      {t('ai.apply')}
                    </button>
                  </div>
                ),
              )}
          </div>
        )}
        {form.equipment_id && (
          <div className="flex flex-col gap-2">
            <span className="label">{t('master.similarRepairs')}</span>
            {similar.isPending && <span className="text-sm opacity-70">{t('common.loading')}</span>}
            {!similar.isPending && (similar.data ?? []).length === 0 && (
              <span className="text-sm opacity-70">{t('master.noSimilar')}</span>
            )}
            {(similar.data ?? []).slice(0, 3).map((r) => (
              <div key={r.id} className="card !p-3">
                <div className="flex items-center justify-between gap-2">
                  <AITag
                    confidence={r.match_score}
                    explanation={(r.match_reasons ?? []).join('; ') || r.fault_name || ''}
                  />
                  <span className="chip">
                    {t('master.historyOrder', { number: r.number ?? '—' })}
                  </span>
                </div>
                {r.fault_code && (
                  <div className="text-sm mt-1">
                    {r.fault_code}
                    {r.fault_name ? ` — ${r.fault_name}` : ''}
                  </div>
                )}
                {r.work_done_text && (
                  <div className="text-sm mt-1">
                    {t('master.repairOutcome')}: {r.work_done_text}
                  </div>
                )}
                {r.materials && r.materials.length > 0 && (
                  <div className="text-sm opacity-80 mt-1">
                    {t('master.materialsUsed')}:{' '}
                    {r.materials.map((m) => `${m.name} ${m.quantity} ${m.unit}`).join(', ')}
                  </div>
                )}
                {r.work_done_text && (
                  <button
                    className="btn btn-sm mt-2"
                    onClick={() =>
                      set(
                        'description',
                        (form.description ? form.description + ' ' : '') + r.work_done_text,
                      )
                    }
                  >
                    {t('master.applyWork')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="label">{t('common.comment')}</span>
          <input
            className="input"
            value={form.comment}
            maxLength={4000}
            onChange={(e) => set('comment', e.target.value)}
          />
        </label>
        <label className="flex gap-2 items-center min-h-[48px]">
          <input
            type="checkbox"
            checked={form.equipment_stopped}
            onChange={(e) => set('equipment_stopped', e.target.checked)}
          />
          {t('master.equipmentStopped')}
        </label>
        <div className="flex flex-col gap-1">
          <span className="label">{t('master.beforePhoto')}</span>
          <label className="file-btn">
            <Icon name="camera" size={22} /> {t('master.beforePhoto')}
            <input
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploadingPhoto || photoIds.length >= 5}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f || uploadingPhoto || photoIds.length >= 5) return;
                try {
                  setUploadingPhoto(true);
                  setPhotoError(null);
                  const r = await uploadPhoto(f, 'before');
                  setPhotoIds((p) => [...p, r.id]);
                } catch (err) {
                  setPhotoError(toLocalizedError(err).message);
                } finally {
                  setUploadingPhoto(false);
                }
              }}
            />
          </label>
          {uploadingPhoto && <span role="status">{t('common.loading')}</span>}
          {photoIds.length > 0 && (
            <span className="chip ok">
              <Icon name="check" size={14} /> {photoIds.length}
            </span>
          )}
          {photoError && (
            <div className="banner banner-danger" role="alert">
              {photoError}
            </div>
          )}
        </div>
        {err && <ErrorState message={err.message} />}
        <button
          className="btn btn-primary btn-xl btn-block"
          disabled={!canSubmit}
          onClick={() => create.mutate()}
        >
          {create.isPending ? t('common.loading') : t('master.newOrder')}
        </button>
      </div>
    </Shell>
  );
}
