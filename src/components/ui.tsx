import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { Priority, WorkOrder, WorkOrderStatus } from '../types/domain';
import { displayOrder, useNames } from '../hooks/useNames';

export function StatusChip({ status, overdue }: { status: WorkOrderStatus; overdue?: boolean }) {
  const { t } = useTranslation();
  const tone: Record<WorkOrderStatus, string> = {
    issued: 'info', accepted: 'brand', queued: 'info', rejected: 'danger',
    in_progress: 'warn', paused: 'neutral', rework: 'danger', done: 'ok',
    ai_review: 'ai', closed: 'ok', cancelled: 'neutral',
  };
  return (
    <span className="flex gap-2 flex-wrap">
      <span className={`chip ${tone[status]}`}>{t(`status.${status}`)}</span>
      {overdue && <span className="chip danger">◷ {t('status.overdue')}</span>}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: Priority }) {
  const { t } = useTranslation();
  return <span className={`prio ${priority}`}>{t(`priority.${priority}`)}</span>;
}

export function OrderCard({ order: raw, to }: { order: WorkOrder; to: string }) {
  const names = useNames();
  const order = displayOrder(raw, names);
  const num = order.number ?? order.id.slice(0, 8);
  return (
    <Link
      to={to}
      className={`card ${order.priority === 'critical' ? 'crit' : ''} ${order.is_overdue ? 'late' : ''} flex flex-col gap-2 min-h-[88px]`}
      aria-label={`Наряд ${num}`}
    >
      <div className="flex items-center gap-2 justify-between">
        <span className="mono">№{String(num)}</span>
        <PriorityTag priority={order.priority} />
      </div>
      <div className="font-semibold leading-6">{order.equipment_name ?? order.equipment_id ?? '—'}</div>
      <div className="text-sm text-[var(--ink-muted)] truncate">
        {[order.area_name ?? order.area_id, order.assignee_name].filter(Boolean).join(' · ')}
      </div>
      <div className="text-[15px] line-clamp-2">{order.description}</div>
      <div className="flex items-center justify-between gap-2">
        <StatusChip status={order.status} overdue={order.is_overdue} />
        <span className="mono text-[var(--ink-muted)]">{order.due_at ? new Date(order.due_at).toLocaleString() : ''}</span>
      </div>
    </Link>
  );
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card flex flex-col gap-2">
          <div className="skel h-5 w-1/3" />
          <div className="skel h-4 w-full" />
          <div className="skel h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="banner banner-danger" role="alert">
      <span className="flex-1">{message}</span>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="card text-center text-[var(--ink-muted)]" role="status">{text}</div>;
}

export function AITag({ confidence, explanation }: { confidence?: number | null; explanation?: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="ai-block" aria-label="Рекомендация ИИ">
      <div className="ai-tag">✦ {t('ai.tag')}</div>
      {typeof confidence === 'number' && <div className="num text-sm mt-1">{t('ai.confidence')}: {Math.round(confidence * 100)} %</div>}
      {explanation && <p className="mt-1 text-[15px]">{explanation}</p>}
    </div>
  );
}
