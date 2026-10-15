import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkOrder, getOrderEvents, transitionOrder } from '../api/workOrders';
import { dictList } from '../api/misc';
import { uploadPhoto, listOrderPhotos, type PhotoKind } from '../api/photos';
import { suggestFaultCode } from '../api/ai';
import { Shell, roleTabs } from '../components/Shell';
import { VoiceButton } from '../components/VoiceButton';
import { displayOrder, useNames } from '../hooks/useNames';
import {
  AITag,
  EmptyState,
  ErrorState,
  PriorityTag,
  SkeletonList,
  StatusChip,
} from '../components/ui';
import { toLocalizedError, newUUID } from '../lib/api-client';
import { formatDT } from '../lib/dates';
import { pickName } from '../lib/names';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { saveOfflinePhoto, type PendingPhotoRef } from '../lib/offline-photos';
import { useAuthStore } from '../store/auth-store';
import { Icon } from '../components/Icon';
import { OfflineQueuePanel } from '../components/OfflineQueuePanel';
import { OrderAssessment, OrderPhotos } from '../components/OrderEvidence';
import { DeadlineTimer } from '../components/WorkerOrderCard';

const ACTION_LABEL: Record<string, string> = {
  accept: 'action.accept',
  reject: 'action.reject',
  start: 'action.start',
  pause: 'action.pause',
  resume: 'action.resume',
  complete: 'action.complete',
  queue: 'action.queue',
  close: 'action.close',
  return_to_rework: 'action.return_to_rework',
  rework: 'action.rework',
  reassign: 'action.reassign',
  cancel: 'action.cancel',
  change_priority: 'action.change_priority',
};

function actionTone(a: string): string {
  if (a === 'accept') return 'btn-ok';
  if (a === 'reject') return 'btn-danger-o';
  if (a === 'start' || a === 'resume') return 'btn-warn';
  return 'btn-primary';
}

/** Buttons come ONLY from backend allowed_actions. Backend owns the state machine. */
export default function WorkerOrder() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const offline = useOfflineQueue();
  const names = useNames();

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => getWorkOrder(id),
    networkMode: 'always',
  });
  const events = useQuery({
    queryKey: ['order', id, 'events'],
    queryFn: () => getOrderEvents(id),
    networkMode: 'always',
  });

  const [reasonCode, setReasonCode] = useState('');
  const [reasonComment, setReasonComment] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [workDone, setWorkDone] = useState('');
  const [faultCodeId, setFaultCodeId] = useState('');
  const [completionComment, setCompletionComment] = useState('');
  const [equipmentRestored, setEquipmentRestored] = useState(true);
  const [usedMaterials, setUsedMaterials] = useState<
    { key: string; material_id: string; quantity: string }[]
  >([]);
  const [afterPct, setAfterPct] = useState<number | null>(null);
  const [afterDone, setAfterDone] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Offline-first after-photos: blobs live in per-employee IndexedDB until replay.
  const [pendingOfflinePhotos, setPendingOfflinePhotos] = useState<PendingPhotoRef[]>([]);
  const photoUserId = useAuthStore((s) => s.user?.id ?? 'anonymous');

  const needsReason = pendingAction === 'reject' || pendingAction === 'pause';
  const completing = pendingAction === 'complete';

  // Причины берём из справочника сервера (русские названия), на сервер уходит англ. code.
  const reasons = useQuery({
    queryKey: ['dict', 'reasons', pendingAction],
    queryFn: () => dictList('reasons', pendingAction ? { kind: pendingAction } : {}),
    enabled: needsReason && !!pendingAction,
  });

  // Шифры — справочник сервера (уходит UUID, не текст). After-фото — уже загруженные + только что.
  const faultCodes = useQuery({
    queryKey: ['catalog', 'fault-codes'],
    queryFn: () => dictList('fault-codes'),
    enabled: completing,
    staleTime: 60000,
  });
  const materials = useQuery({
    queryKey: ['catalog', 'materials'],
    queryFn: () => dictList('materials'),
    enabled: completing,
    staleTime: 60000,
    networkMode: 'always',
  });
  const invalidMaterials = usedMaterials.some(
    (item) =>
      !item.material_id ||
      !Number.isFinite(Number(item.quantity)) ||
      Number(item.quantity) <= 0 ||
      Number(item.quantity) > 1_000_000,
  );
  const orderPhotos = useQuery({
    queryKey: ['order', id, 'photos'],
    queryFn: () => listOrderPhotos(id),
    enabled: completing,
    networkMode: 'always',
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const transition = useMutation({
    // Как и в WorkerHome: офлайн-мутация должна выполняться без сети.
    networkMode: 'always',
    mutationFn: (vars: { action: string; body?: Record<string, unknown> }) => {
      // Offline: queue worker mutations with a stable Idempotency-Key, send when back online.
      const isOffline =
        !offline.online || (typeof navigator !== 'undefined' && navigator.onLine === false);
      const offlinePhotos =
        vars.action === 'complete' && pendingOfflinePhotos.length > 0
          ? pendingOfflinePhotos.map((p) => ({ localId: p.localId, kind: p.kind }))
          : [];
      // A complete with locally stored photos must go through the queue even when
      // back online: replay uploads blobs first (upload-then-act) with the same key.
      const mustQueue =
        (isOffline &&
          ['accept', 'queue', 'start', 'pause', 'resume', 'complete'].includes(vars.action)) ||
        offlinePhotos.length > 0;
      if (mustQueue) {
        const key = newUUID();
        const promise = offline.enqueue({
          key,
          orderId: id,
          action: vars.action,
          body: vars.body ?? {},
          clientAt: new Date().toISOString(),
          ...(offlinePhotos.length > 0 ? { pendingPhotos: offlinePhotos } : {}),
        });
        return promise.then(() => {
          if (offlinePhotos.length > 0) setPendingOfflinePhotos([]);
          return { queued: true as const };
        });
      }
      return transitionOrder(id, vars.action, vars.body ?? {}, newUUID());
    },
    onSuccess: () => {
      setPendingAction(null);
      setReasonCode('');
      setReasonComment('');
      invalidate();
    },
  });

  const faultSuggest = useMutation({
    mutationFn: () => suggestFaultCode({ description: order.data?.description ?? '' }),
  });

  const closeSheet = () => {
    if (transition.isPending || (afterPct !== null && afterPct < 100)) return;
    setPendingAction(null);
    setReasonCode('');
    setReasonComment('');
  };

  const onPhoto = async (file: File, kind: PhotoKind) => {
    const isOffline =
      !offline.online || (typeof navigator !== 'undefined' && navigator.onLine === false);
    if (isOffline) {
      // No network: keep the blob in per-employee IndexedDB; replay uploads it
      // before the complete action (upload-then-act) and survives reload.
      try {
        setPhotoError(null);
        const rec = await saveOfflinePhoto(photoUserId, file, kind, file.name);
        setPendingOfflinePhotos((p) =>
          p.length >= 5 ? p : [...p, { localId: rec.localId, kind: rec.kind }],
        );
        if (kind === 'after') setAfterDone(true);
      } catch (e) {
        setPhotoError(toLocalizedError(e).message);
      }
      return;
    }
    try {
      setPhotoError(null);
      setAfterPct(0);
      await uploadPhoto(file, kind, id, setAfterPct);
      setAfterPct(100);
      if (kind === 'after') setAfterDone(true);
      invalidate();
    } catch (e) {
      setAfterPct(null);
      setPhotoError(toLocalizedError(e).message);
    }
  };

  if (order.isPending)
    return (
      <Shell title="…" tabs={roleTabs(t, 'worker')}>
        <SkeletonList />
      </Shell>
    );
  if (order.isError)
    return (
      <Shell title="!" tabs={roleTabs(t, 'worker')}>
        <ErrorState
          message={toLocalizedError(order.error).message}
          onRetry={() => order.refetch()}
        />
      </Shell>
    );

  const o = displayOrder(order.data, names, (i18n.language || 'ru').slice(0, 2));
  const actions = o.allowed_actions ?? [];

  return (
    <Shell title={`№${o.number ?? o.id.slice(0, 8)}`} tabs={roleTabs(t, 'worker')}>
      <div className="card flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <PriorityTag priority={o.priority} />
          <StatusChip status={o.status} overdue={o.is_overdue} />
        </div>
        <div className="font-bold text-[20px]">{o.equipment_name ?? o.equipment_id}</div>
        <div className="text-sm text-[var(--ink-muted)]">
          {[o.area_name ?? o.area_id, o.assignee_name].filter(Boolean).join(' · ')}
        </div>
        <p className="text-[18px] leading-[26px]">{o.description}</p>
        <div className="mono text-[var(--ink-muted)]">
          {t('master.due')}: {o.due_at ? formatDT(o.due_at) : '—'}
          {o.norm_minutes ? ` · norm ${o.norm_minutes}′` : ''}
        </div>
        <DeadlineTimer dueAt={o.due_at} />
      </div>

      {/* Primary actions from allowed_actions */}
      {!completing && actions.length === 0 && !['closed', 'cancelled'].includes(o.status) && (
        <div className="banner banner-warn flex gap-2 items-center" role="status">
          <span className="flex-1">{t('worker.noActions')}</span>
          <button className="btn btn-sm" onClick={invalidate}>
            {t('common.refresh')}
          </button>
        </div>
      )}
      {!completing && actions.length > 0 && (
        <div className="dock-sticky">
          {actions.map((a, i) => (
            <button
              key={a}
              className={`btn btn-block ${i === 0 ? 'btn-xl' : ''} ${actionTone(a)}`}
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
        <div className="modal-scrim" onClick={closeSheet} role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={t('worker.reasonTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <b>{t('worker.reasonTitle')}</b>
            <label className="flex flex-col gap-1">
              <span className="label">{t('worker.chooseReason')}</span>
              <select
                className="input"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                aria-label={t('worker.chooseReason')}
              >
                <option value="">—</option>
                {((reasons.data ?? []) as { code: string; name: string; name_kk?: string }[]).map(
                  (r) => (
                    <option key={r.code} value={r.code}>
                      {pickName(r, (i18n.language || 'ru').slice(0, 2)) || r.name}
                    </option>
                  ),
                )}
              </select>
            </label>
            <input
              className="input"
              value={reasonComment}
              onChange={(e) => setReasonComment(e.target.value)}
              placeholder={t('worker.extraComment')}
              aria-label={t('worker.extraComment')}
            />
            {transition.isError && (
              <ErrorState message={toLocalizedError(transition.error).message} />
            )}
            <div className="flex gap-2">
              <button className="btn" onClick={closeSheet} disabled={transition.isPending}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary grow"
                disabled={!reasonCode || transition.isPending}
                onClick={() =>
                  transition.mutate({
                    action: pendingAction,
                    body: { reason_code: reasonCode, comment: reasonComment || undefined },
                  })
                }
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete form — real backend schema: work_done_text + fault_code UUID обязательны */}
      {completing && (
        <div className="modal-scrim" onClick={closeSheet} role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={t('worker.completeTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <b>{t('worker.completeTitle')}</b>
            <div className="flex flex-col gap-1">
              <div className="label">
                <label htmlFor="completion-work-done">{t('worker.workDone')} *</label>{' '}
                <VoiceButton
                  workOrderId={id}
                  onText={(txt) => setWorkDone((w) => (w ? w + ' ' : '') + txt)}
                />
              </div>
              <textarea
                id="completion-work-done"
                className="input area"
                value={workDone}
                onChange={(e) => setWorkDone(e.target.value)}
                required
                maxLength={4000}
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className="label">{t('worker.faultCode')} *</span>
              <select
                className="input"
                value={faultCodeId}
                onChange={(e) => setFaultCodeId(e.target.value)}
                aria-label={t('worker.faultCode')}
              >
                <option value="">—</option>
                {(
                  (faultCodes.data ?? []) as {
                    id: string;
                    code: string;
                    name: string;
                    name_kk?: string;
                  }[]
                ).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} · {pickName(f, (i18n.language || 'ru').slice(0, 2)) || f.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 items-center">
              <button
                className="btn btn-ai btn-sm"
                onClick={() => faultSuggest.mutate()}
                disabled={faultSuggest.isPending}
              >
                <Icon name="spark" size={16} /> {t('ai.recommendation')}
              </button>
            </div>
            {faultSuggest.data && (
              <>
                <AITag
                  confidence={faultSuggest.data.confidence}
                  explanation={faultSuggest.data.name ?? faultSuggest.data.code}
                />
                {faultSuggest.data.fault_code_id && (
                  <button
                    className="btn btn-sm btn-ai self-start"
                    onClick={() => setFaultCodeId(String(faultSuggest.data.fault_code_id))}
                  >
                    {t('ai.apply')}: {faultSuggest.data.code}
                  </button>
                )}
              </>
            )}
            <fieldset className="flex flex-col gap-2 min-w-0">
              <legend className="label">{t('worker.materials')}</legend>
              {materials.isPending && <span role="status">{t('common.loading')}</span>}
              {materials.isError && (
                <ErrorState
                  message={toLocalizedError(materials.error).message}
                  onRetry={() => materials.refetch()}
                />
              )}
              {usedMaterials.map((item, index) => (
                <div key={item.key} className="card !p-3 flex flex-col gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="label">
                      {t('worker.material')} {index + 1}
                    </span>
                    <select
                      className="input w-full"
                      value={item.material_id}
                      onChange={(e) =>
                        setUsedMaterials((items) =>
                          items.map((row) =>
                            row.key === item.key ? { ...row, material_id: e.target.value } : row,
                          ),
                        )
                      }
                    >
                      <option value="">—</option>
                      {(
                        (materials.data ?? []) as {
                          id: string;
                          name: string;
                          name_kk?: string;
                          unit: string;
                        }[]
                      ).map((material) => (
                        <option
                          key={material.id}
                          value={material.id}
                          disabled={usedMaterials.some(
                            (row) => row.key !== item.key && row.material_id === material.id,
                          )}
                        >
                          {pickName(material, (i18n.language || 'ru').slice(0, 2)) || material.name}{' '}
                          · {material.unit}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="label">
                      {t('worker.quantity')} {index + 1}
                    </span>
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      min="0.001"
                      max="1000000"
                      step="any"
                      value={item.quantity}
                      onChange={(e) =>
                        setUsedMaterials((items) =>
                          items.map((row) =>
                            row.key === item.key ? { ...row, quantity: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="btn btn-danger-o"
                    onClick={() =>
                      setUsedMaterials((items) => items.filter((row) => row.key !== item.key))
                    }
                    aria-label={`${t('worker.removeMaterial')} ${index + 1}`}
                  >
                    {t('worker.removeMaterial')}
                  </button>
                </div>
              ))}
              <button
                className="btn"
                disabled={materials.isPending || materials.isError || usedMaterials.length >= 100}
                onClick={() =>
                  setUsedMaterials((items) => [
                    ...items,
                    { key: newUUID(), material_id: '', quantity: '1' },
                  ])
                }
              >
                {t('worker.addMaterial')}
              </button>
              {invalidMaterials && <span role="note">{t('worker.invalidMaterial')}</span>}
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className="label">{t('worker.extraComment')}</span>
              <input
                className="input"
                value={completionComment}
                maxLength={4000}
                onChange={(e) => setCompletionComment(e.target.value)}
              />
            </label>
            <label className="flex gap-2 items-center min-h-[48px]">
              <input
                type="checkbox"
                checked={equipmentRestored}
                onChange={(e) => setEquipmentRestored(e.target.checked)}
              />
              {t('worker.restored')}
            </label>
            <div className="flex flex-col gap-1">
              <span className="label">{t('worker.afterPhotos')}</span>
              <label className="file-btn">
                <Icon name="camera" size={22} /> {t('worker.afterPhotos')}
                <input
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={afterPct !== null && afterPct < 100}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onPhoto(f, 'after');
                  }}
                />
              </label>
              {afterPct !== null && (
                <div
                  className="mono text-sm text-[var(--ink-muted)]"
                  aria-label={t('worker.afterPhotos')}
                >
                  {t('worker.afterPhotos')}: {Math.round(afterPct)}%
                </div>
              )}
              {pendingOfflinePhotos.length > 0 && (
                <div className="mono text-sm text-[var(--ink-muted)]" role="status">
                  {t('common.queued')}: {pendingOfflinePhotos.length}
                </div>
              )}
              {photoError && (
                <div className="banner banner-danger" role="alert">
                  {photoError}
                </div>
              )}
            </div>
            {o.kind === 'unplanned' &&
              !afterDone &&
              pendingOfflinePhotos.length === 0 &&
              !((orderPhotos.data ?? []) as { kind?: string }[]).some(
                (p) => p.kind === 'after',
              ) && (
                <div className="banner banner-warn" role="note">
                  {t('worker.needAfterPhoto')}
                </div>
              )}
            {transition.isError && (
              <ErrorState message={toLocalizedError(transition.error).message} />
            )}
            <div className="flex gap-2">
              <button className="btn" onClick={closeSheet} disabled={transition.isPending}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-ok grow"
                disabled={
                  !workDone.trim() ||
                  !faultCodeId ||
                  invalidMaterials ||
                  transition.isPending ||
                  (afterPct !== null && afterPct < 100)
                }
                onClick={() =>
                  transition.mutate({
                    action: 'complete',
                    body: {
                      comment: completionComment.trim() || undefined,
                      form: {
                        work_done_text: workDone.trim(),
                        fault_code_id: faultCodeId,
                        materials: usedMaterials.map(({ material_id, quantity }) => ({
                          material_id,
                          quantity: Number(quantity),
                        })),
                        equipment_restored: equipmentRestored,
                        comment: completionComment.trim() || undefined,
                      },
                    },
                  })
                }
              >
                {t('action.complete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {!pendingAction && transition.isError && (
        <ErrorState message={toLocalizedError(transition.error).message} />
      )}
      {'queued' in (transition.data ?? {}) && (
        <div className="banner banner-warn" role="status">
          {t('common.offline')} · {t('common.queued')}
        </div>
      )}
      <OfflineQueuePanel
        queue={offline.queue}
        notices={offline.notices ?? []}
        online={offline.online}
        replaying={offline.replaying}
        lastReplayError={offline.lastReplayError}
        orderId={id}
        onReplay={() => {
          void offline.replay().then(() => qc.invalidateQueries({ queryKey: ['order', id] }));
        }}
        onRemove={(key) => void offline.remove(key)}
        onDismiss={(key) => void offline.dismissNotice(key)}
      />

      <OrderAssessment review={o.ai_review} />
      <OrderPhotos photos={o.photos} />
      <section>
        <h3 className="sec-h">{t('common.timeline')}</h3>
        {Array.isArray(events.data) && events.data.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {(
              events.data as {
                action?: string;
                at?: string;
                actor?: string;
                actor_id?: string;
                comment?: string;
              }[]
            )
              .slice(0, 20)
              .map((e, i) => (
                <li key={i} className="card !p-3 text-sm">
                  <span className="mono text-[var(--ink-muted)]">{e.at ? formatDT(e.at) : ''}</span>{' '}
                  ·{' '}
                  {e.action
                    ? t(`action.${e.action}`, { defaultValue: t(`status.${e.action}`, e.action) })
                    : ''}{' '}
                  · {e.actor ?? (e.actor_id ? (names.users.get(e.actor_id) ?? e.actor_id) : '')}
                  {e.comment && <p>{e.comment}</p>}
                </li>
              ))}
          </ol>
        ) : (
          <EmptyState text={t('common.empty')} />
        )}
      </section>
    </Shell>
  );
}
