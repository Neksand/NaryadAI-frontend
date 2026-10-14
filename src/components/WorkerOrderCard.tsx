import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { WorkOrder } from '../types/domain';
import { displayOrder, useNames } from '../hooks/useNames';
import { deadlineState } from '../lib/deadline';
import { formatDT } from '../lib/dates';
import { Icon } from './Icon';
import { PriorityTag, StatusChip } from './ui';

export function DeadlineTimer({ dueAt }: { dueAt?: string | null }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const state = deadlineState(dueAt, now);
  if (state.kind === 'none') return null;
  const duration =
    state.days > 0
      ? t('worker.deadline.daysHours', { days: state.days, hours: state.hours })
      : state.hours > 0
        ? t('worker.deadline.hoursMinutes', { hours: state.hours, minutes: state.minutes })
        : t('worker.deadline.minutes', { minutes: state.minutes });
  return (
    <span
      className={`chip ${state.kind === 'overdue' ? 'danger' : 'warn'}`}
      aria-label={
        state.kind === 'overdue'
          ? t('worker.deadline.overdueBy', { duration })
          : t('worker.deadline.remaining', { duration })
      }
    >
      <Icon name="clock" size={14} />{' '}
      {state.kind === 'overdue'
        ? t('worker.deadline.overdueBy', { duration })
        : t('worker.deadline.remaining', { duration })}
    </span>
  );
}

export function WorkerOrderCard({
  order: raw,
  onQuickAction,
  quickActionPending = false,
  queued = false,
}: {
  order: WorkOrder;
  onQuickAction?: (order: WorkOrder, action: string) => void;
  quickActionPending?: boolean;
  queued?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'ru').slice(0, 2);
  const names = useNames();
  const order = displayOrder(raw, names, lang);
  const number = order.number ?? order.id.slice(0, 8);
  const nextAction = order.allowed_actions[0];
  const path = `/worker/orders/${order.id}`;
  const canRunQuickly = Boolean(
    nextAction && ['accept', 'queue', 'start', 'resume'].includes(nextAction) && onQuickAction,
  );

  return (
    <article
      className={`card orail ${order.priority} ${order.is_overdue ? 'late' : ''} flex flex-col gap-2`}
    >
      <Link to={path} className="flex flex-col gap-2" aria-label={`${t('order.title')} ${number}`}>
        <div className="flex items-center gap-2 justify-between">
          <span className="mono">№{String(number)}</span>
          <PriorityTag priority={order.priority} />
        </div>
        <div className="font-semibold leading-6">
          {order.equipment_name ?? order.equipment_id ?? '—'}
        </div>
        <div className="text-sm text-[var(--ink-muted)] truncate">
          {[order.area_name ?? order.area_id, order.assignee_name].filter(Boolean).join(' · ')}
        </div>
        <div className="text-[15px] line-clamp-2">{order.description}</div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <StatusChip status={order.status} overdue={order.is_overdue} />
          {order.due_at && (
            <span className="mono text-[var(--ink-muted)]">
              {t('master.due')}: {formatDT(order.due_at, lang)}
            </span>
          )}
        </div>
      </Link>
      <div className="flex justify-between items-center gap-2 flex-wrap border-t border-[var(--line)] pt-2">
        <DeadlineTimer dueAt={order.due_at} />
        {canRunQuickly ? (
          <button
            className="btn btn-sm btn-primary ml-auto"
            type="button"
            disabled={quickActionPending || queued}
            onClick={() => onQuickAction?.(order, nextAction!)}
          >
            {queued ? t('common.queued') : t(`action.${nextAction}`, t('worker.openOrder'))}
            <Icon name="arrowRight" size={16} />
          </button>
        ) : (
          <Link className="btn btn-sm btn-primary ml-auto" to={path}>
            {nextAction ? t(`action.${nextAction}`, t('worker.openOrder')) : t('worker.openOrder')}
            <Icon name="arrowRight" size={16} />
          </Link>
        )}
      </div>
    </article>
  );
}
