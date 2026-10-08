import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkOrder, getOrderEvents, transitionOrder } from '../api/workOrders';
import { dictList } from '../api/misc';
import { uploadPhoto, listOrderPhotos, type PhotoKind } from '../api/photos';
import { suggestFaultCode } from '../api/ai';
import { Shell } from '../components/Shell';
import { VoiceButton } from '../components/VoiceButton';
import { displayOrder, useNames } from '../hooks/useNames';
import { AITag, EmptyState, ErrorState, PriorityTag, SkeletonList, StatusChip } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

const ACTION_LABEL: Record<string, string> = {
  accept: 'action.accept', reject: 'action.reject', start: 'action.start',
  pause: 'action.pause', resume: 'action.resume', complete: 'action.complete', queue: 'action.queue',
};

/** Buttons come ONLY from backend allowed_actions. Backend owns the state machine. */
export default function WorkerOrder() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { online, enqueue } = useOfflineQueue();
  const names = useNames();

  const order = useQuery({ queryKey: ['order', id], queryFn: () => getWorkOrder(id) });
  const events = useQuery({ queryKey: ['order', id, 'events'], queryFn: () => getOrderEvents(id) });

  const [reasonCode, setReasonCode] = useState('');
  const [reasonComment, setReasonComment] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [workDone, setWorkDone] = useState('');
  const [faultCodeId, setFaultCodeId] = useState('');
  const [afterPct, setAfterPct] = useState<number | null>(null);
  const [afterDone, setAfterDone] = useState(false);

  const needsReason = pendingAction === 'reject' || pendingAction === 'pause';
  const completing = pendingAction === 'complete';

  // Причины берём из справочника сервера (русские названия), на сервер уходит англ. code.
  const reasons = useQuery({
    queryKey: ['dict', 'reasons', pendingAction],
    queryFn: () => dictList('reasons', pendingAction ? { kind: pendingAction } : {}),
    enabled: needsReason && !!pendingAction,
  });

  // Шифры — справочник сервера (уходит UUID, не текст). After-фото — уже загруженные + только что.
  const faultCodes = useQuery({ queryKey: ['catalog', 'fault-codes'], queryFn: () => dictList('fault-codes'), enabled: completing, staleTime: 60000 });
  const orderPhotos = useQuery({ queryKey: ['order', id, 'photos'], queryFn: () => listOrderPhotos(id), enabled: completing });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const transition = useMutation({
    mutationFn: (vars: { action: string; body?: Record<string, unknown> }) => {
      // Offline: queue worker mutations with a stable Idempotency-Key, send when back online.
      if (!online && ['accept', 'queue', 'start', 'pause', 'resume', 'complete'].includes(vars.action)) {
        const key = crypto.randomUUID();
        return enqueue({ key, orderId: id, action: vars.action, body: vars.body ?? {}, clientAt: new Date().toISOString() })
          .then(() => ({ queued: true as const }));
      }
      return transitionOrder(id, vars.action, vars.body ?? {}, crypto.randomUUID());
    },
    onSuccess: () => { setPendingAction(null); setReasonCode(''); setReasonComment(''); invalidate(); },
  });

  const faultSuggest = useMutation({ mutationFn: () => suggestFaultCode({ description: order.data?.description ?? '' }) });

  const onPhoto = async (file: File, kind: PhotoKind) => {
    try {
      setAfterPct(0);
      await uploadPhoto(file, kind, id, setAfterPct);
      setAfterPct(100);
      if (kind === 'after') setAfterDone(true);
      invalidate();
    } catch {
      setAfterPct(null);
    }
  };

  if (order.isPending) return <Shell title="…" tabs={[{ to: '/worker', label: t('nav.orders') }]}><SkeletonList /></Shell>;
  if (order.isError) return <Shell title="!" tabs={[{ to: '/worker', label: t('nav.orders') }]}><ErrorState message={toLocalizedError(order.error).message} onRetry={() => order.refetch()} /></Shell>;

  const o = displayOrder(order.data, names);
  const actions = o.allowed_actions ?? [];

  return (
    <Shell title={`№${o.number ?? o.id.slice(0, 8)}`} tabs={[{ to: '/worker', label: t('nav.orders') }]}>
      <div className="card flex flex-col gap-2">
        <div className="flex justify-between items-center"><PriorityTag priority={o.priority} /><StatusChip status={o.status} overdue={o.is_overdue} /></div>
        <div className="font-bold text-[20px]">{o.equipment_name ?? o.equipment_id}</div>
        <div className="text-sm text-[var(--ink-muted)]">{[o.area_name ?? o.area_id, o.assignee_name].filter(Boolean).join(' · ')}</div>
        <p className="text-[18px] leading-[26px]">{o.description}</p>
        <div className="mono text-[var(--ink-muted)]">
          {t('master.due')}: {o.due_at ? new Date(o.due_at).toLocaleString() : '—'}
          {o.norm_minutes ? ` · norm ${o.norm_minutes}′` : ''}
        </div>
      </div>

      {/* Primary actions from allowed_actions */}
      {!completing && (
        <div className="dock !p-0 !bg-transparent !border-0">
          {actions.length === 0 && <EmptyState text={t('common.empty')} />}
          {actions.map((a) => (
            <button
              key={a}
              className={`btn btn-xl btn-block ${a === 'accept' ? 'btn-ok' : a === 'reject' ? 'btn-danger-o' : a === 'start' || a === 'resume' ? 'btn-warn' : 'btn-primary'}`}
              disabled={transition.isPending}
              onClick={() => {
                if (a === 'reject' || a === 'pause' || a === 'complete') setPendingAction(a);
                else transition.mutate({ action: a });
              }}
            >
              {t(ACTION_LABEL[a] ?? `action.${a}`, a)}
            </button>
          ))}
        </div>
      )}

      {/* Reason sheet: справочник причин с сервера; reject/pause требуют reason_code */}
      {needsReason && pendingAction && (
        <div className="card flex flex-col gap-2" role="dialog" aria-label={t('worker.reasonTitle')}>
          <b>{t('worker.reasonTitle')}</b>
          <label className="flex flex-col gap-1"><span className="label">{t('worker.chooseReason')}</span>
            <select className="input" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} aria-label={t('worker.chooseReason')}>
              <option value="">—</option>
              {((reasons.data ?? []) as { code: string; name: string }[]).map((r) => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </select>
          </label>
          <input className="input" value={reasonComment} onChange={(e) => setReasonComment(e.target.value)} placeholder={t('worker.extraComment')} aria-label={t('worker.extraComment')} />
          <div className="flex gap-2">
            <button className="btn" onClick={() => { setPendingAction(null); setReasonCode(''); }}>{t('common.cancel')}</button>
            <button
              className="btn btn-primary grow" disabled={!reasonCode || transition.isPending}
              onClick={() => transition.mutate({ action: pendingAction, body: { reason_code: reasonCode, comment: reasonComment || undefined } })}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      )}

      {/* Complete form — real backend schema: work_done_text + fault_code UUID обязательны */}
      {completing && (
        <div className="card flex flex-col gap-2" role="dialog" aria-label={t('worker.completeTitle')}>
          <b>{t('worker.completeTitle')}</b>
          <label className="flex flex-col gap-1"><span className="label">{t('worker.workDone')} * <VoiceButton workOrderId={id} onText={(txt) => setWorkDone((w) => (w ? w + ' ' : '') + txt)} /></span>
            <textarea className="input area" value={workDone} onChange={(e) => setWorkDone(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1"><span className="label">{t('worker.faultCode')} *</span>
            <select className="input" value={faultCodeId} onChange={(e) => setFaultCodeId(e.target.value)} aria-label={t('worker.faultCode')}>
              <option value="">—</option>
              {((faultCodes.data ?? []) as { id: string; code: string; name: string }[]).map((f) => (
                <option key={f.id} value={f.id}>{f.code} · {f.name}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 items-center">
            <button className="btn btn-ai btn-sm" onClick={() => faultSuggest.mutate()} disabled={faultSuggest.isPending}>✦ {t('ai.recommendation')}</button>
          </div>
          {faultSuggest.data && (
            <>
              <AITag confidence={faultSuggest.data.confidence} explanation={faultSuggest.data.name ?? faultSuggest.data.code} />
              {faultSuggest.data.fault_code_id && (
                <button className="btn btn-sm btn-ai self-start" onClick={() => setFaultCodeId(String(faultSuggest.data.fault_code_id))}>{t('ai.apply')}: {faultSuggest.data.code}</button>
              )}
            </>
          )}
          <label className="flex flex-col gap-1"><span className="label">{t('worker.afterPhotos')}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f, 'after'); }} />
            {afterPct !== null && <progress value={afterPct} max={100} className="w-full" aria-label={t('worker.afterPhotos')} />}
          </label>
          {(o.kind === 'unplanned' && !afterDone && !((orderPhotos.data ?? []) as { kind?: string }[]).some((p) => p.kind === 'after')) && (
            <div className="banner banner-warn" role="note">{t('worker.needAfterPhoto')}</div>
          )}
          <div className="flex gap-2">
            <button className="btn" onClick={() => setPendingAction(null)}>{t('common.cancel')}</button>
            <button
              className="btn btn-ok grow" disabled={!workDone.trim() || !faultCodeId || transition.isPending}
              onClick={() => transition.mutate({
                action: 'complete',
                body: { form: { work_done_text: workDone.trim(), fault_code_id: faultCodeId, materials: [], equipment_restored: true } },
              })}
            >
              {t('action.complete')}
            </button>
          </div>
        </div>
      )}

      {transition.isError && <ErrorState message={toLocalizedError(transition.error).message} />}
      {'queued' in (transition.data ?? {}) && <div className="banner banner-warn" role="status">{t('common.offline')} · {t('common.queued')}</div>}

      <section>
        <h3 className="sec-h">{t('common.timeline')}</h3>
        {Array.isArray(events.data) && events.data.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {(events.data as { action?: string; at?: string; actor?: string }[]).slice(0, 20).map((e, i) => (
              <li key={i} className="card !p-3 text-sm"><span className="mono text-[var(--ink-muted)]">{e.at ? new Date(e.at).toLocaleString() : ''}</span> · {e.action} · {e.actor ?? ''}</li>
            ))}
          </ol>
        ) : <EmptyState text={t('common.empty')} />}
      </section>
    </Shell>
  );
}
