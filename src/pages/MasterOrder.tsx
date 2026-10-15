import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getEquipmentHistory,
  getWorkOrder,
  transitionOrder,
  type EquipmentHistoryItem,
} from '../api/workOrders';
import { Shell, roleTabs } from '../components/Shell';
import { displayOrder, useNames } from '../hooks/useNames';
import { ErrorState, PriorityTag, SkeletonList, StatusChip } from '../components/ui';
import VersionConflictNotice from '../components/VersionConflictNotice';
import { toLocalizedError, newUUID } from '../lib/api-client';
import { Icon } from '../components/Icon';

function currentVersionFromError(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const details = (
    error as {
      response?: { data?: { error?: { details?: { current_version?: unknown } } } };
    }
  ).response?.data?.error?.details;
  return typeof details?.current_version === 'number' ? details.current_version : null;
}

/** Master order view: renders backend allowed_actions (close/reassign/cancel/change_priority/…). */
export default function MasterOrder() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const names = useNames();
  const [assignee, setAssignee] = useState('');

  const order = useQuery({ queryKey: ['order', id], queryFn: () => getWorkOrder(id) });
  const equipmentId = order.data?.equipment_id;
  const equipmentHistory = useQuery({
    queryKey: ['equipment-history', equipmentId],
    queryFn: () => (equipmentId ? getEquipmentHistory(equipmentId) : Promise.resolve([])),
    enabled: Boolean(equipmentId),
  });
  const act = useMutation({
    mutationFn: (vars: { action: string; body?: Record<string, unknown> }) =>
      transitionOrder(id, vars.action, vars.body ?? {}, newUUID()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['order', id] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  const actError = act.isError ? toLocalizedError(act.error) : null;
  const conflictVersion =
    actError?.code === 'version_conflict' ? currentVersionFromError(act.error) : null;

  if (order.isPending)
    return (
      <Shell title="…" tabs={roleTabs(t, 'master')}>
        <SkeletonList />
      </Shell>
    );
  if (order.isError)
    return (
      <Shell title="!" tabs={roleTabs(t, 'master')}>
        <ErrorState message={toLocalizedError(order.error).message} />
      </Shell>
    );
  const o = displayOrder(order.data, names, (i18n.language || 'ru').slice(0, 2));

  return (
    <Shell title={`№${o.number ?? o.id.slice(0, 8)}`} tabs={roleTabs(t, 'master')}>
      <div className="card flex flex-col gap-2">
        <div className="flex justify-between">
          <PriorityTag priority={o.priority} />
          <StatusChip status={o.status} overdue={o.is_overdue} />
        </div>
        <p className="text-[16px]">{o.description}</p>
        <div className="text-sm text-[var(--ink-muted)]">
          {[o.equipment_name, o.area_name, o.assignee_name].filter(Boolean).join(' · ')}
        </div>
        <div className="mono text-[var(--ink-muted)] text-xs">
          {t('common.actions')}:{' '}
          {(o.allowed_actions ?? []).map((a) => t(`action.${a}`, a)).join(', ') || '—'}
        </div>
      </div>

      {o.equipment_id && (
        <section aria-label={t('master.repairHistory')}>
          <h2 className="font-bold text-[17px] mb-2">{t('master.repairHistory')}</h2>
          {equipmentHistory.isPending ? (
            <SkeletonList rows={1} />
          ) : equipmentHistory.isError ? (
            <ErrorState
              message={toLocalizedError(equipmentHistory.error).message}
              onRetry={() => void equipmentHistory.refetch()}
            />
          ) : (
            <RepairHistory
              items={equipmentHistory.data ?? []}
              currentOrderId={o.id}
              lang={(i18n.language || 'ru').slice(0, 2)}
            />
          )}
        </section>
      )}

      <div className="flex flex-col gap-2">
        {(o.allowed_actions ?? []).map((a) => {
          if (a === 'close')
            return (
              <Link key={a} className="btn btn-ok btn-block" to={`/master/review/${o.id}`}>
                {t('action.close')} <Icon name="arrowRight" size={16} />
              </Link>
            );
          if (a === 'return_to_rework')
            return (
              <Link key={a} className="btn btn-danger btn-block" to={`/master/review/${o.id}`}>
                {t('action.rework')} <Icon name="arrowRight" size={16} />
              </Link>
            );
          if (a === 'reassign')
            return (
              <div key={a} className="card flex gap-2">
                <input
                  className="input"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder={t('master.assigneeIdPh')}
                  aria-label={t('master.assignee')}
                />
                <button
                  className="btn btn-primary"
                  disabled={!assignee || act.isPending}
                  onClick={() =>
                    act.mutate({ action: 'reassign', body: { assignee_id: assignee } })
                  }
                >
                  {t('action.reassign')}
                </button>
              </div>
            );
          return (
            <button
              key={a}
              className="btn btn-block"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: a })}
            >
              {t(`action.${a}`, a)}
            </button>
          );
        })}
        {(o.allowed_actions ?? []).length === 0 && (
          <div className="banner banner-warn flex gap-2 items-center" role="status">
            <span className="flex-1">{t('worker.noActions')}</span>
          </div>
        )}
      </div>
      {act.isError && conflictVersion !== null ? (
        <VersionConflictNotice
          currentVersion={conflictVersion}
          onRefresh={async () => {
            act.reset();
            await Promise.all([order.refetch(), qc.invalidateQueries({ queryKey: ['orders'] })]);
          }}
        />
      ) : act.isError ? (
        <ErrorState message={toLocalizedError(act.error).message} />
      ) : null}
    </Shell>
  );
}

function RepairHistory({
  items,
  currentOrderId,
  lang,
}: {
  items: EquipmentHistoryItem[];
  currentOrderId: string;
  lang: string;
}) {
  const { t } = useTranslation();
  if (!items.length)
    return (
      <div className="card text-[var(--ink-muted)]" role="status">
        {t('master.noRepairHistory')}
      </div>
    );

  const current = items.find((item) => item.id === currentOrderId);
  const currentFault = current?.fault_code_id;
  const faultRepeats = currentFault
    ? items.filter((item) => item.id !== currentOrderId && item.fault_code_id === currentFault)
        .length
    : 0;
  // Сервер считает возвраты наряда (return_count): показываем максимум из совпадений
  // шифра и счётчика текущего наряда, чтобы повтор не терялся без fault_code_id.
  const repeats = Math.max(faultRepeats, current?.return_count ?? 0);
  const rows = items.slice(0, 5);
  return (
    <div className="flex flex-col gap-2">
      {repeats > 0 && (
        <div className="banner banner-warn" role="status">
          {t('master.repeatedFault', { count: repeats })}
        </div>
      )}
      {rows.map((item) => {
        const date =
          item.issued_at && !Number.isNaN(Date.parse(item.issued_at))
            ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(
                new Date(item.issued_at),
              )
            : '—';
        const status = item.status ? t(`status.${item.status}`, item.status) : '—';
        const fault =
          lang === 'kk'
            ? item.fault_name_kk || item.fault_name || item.fault_code
            : item.fault_name || item.fault_code;
        return (
          <article key={item.id} className="card flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <Link className="font-semibold text-[var(--brand)]" to={`/master/orders/${item.id}`}>
                {t('master.historyOrder', { number: item.number ?? item.id.slice(0, 8) })}
              </Link>
              <span className="chip">{status}</span>
            </div>
            <div className="text-sm text-[var(--ink-muted)]">
              {date}
              {fault ? ` · ${fault}` : ''}
            </div>
            {item.description && <p className="text-sm">{item.description}</p>}
            {item.work_done_text && (
              <p className="text-sm text-[var(--ink-muted)]">
                {t('master.repairOutcome')}: {item.work_done_text}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
