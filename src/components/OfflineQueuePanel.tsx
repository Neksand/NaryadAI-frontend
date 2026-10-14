import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { QueueNotice, QueuedOp } from '../hooks/useOfflineQueue';

export function OfflineQueuePanel({
  queue,
  notices,
  online,
  replaying,
  lastReplayError,
  onReplay,
  onRemove,
  onDismiss,
  orderId,
}: {
  queue: QueuedOp[];
  notices: QueueNotice[];
  online: boolean;
  replaying: boolean;
  lastReplayError: string | null;
  onReplay: () => void;
  onRemove: (key: string) => void;
  onDismiss: (key: string) => void;
  orderId?: string;
}) {
  const { t } = useTranslation();
  const visibleQueue = orderId ? queue.filter((op) => op.orderId === orderId) : queue;
  const visibleNotices = orderId ? notices.filter((notice) => notice.orderId === orderId) : notices;

  if (!visibleQueue.length && !visibleNotices.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={t('worker.sync.title')}>
      {visibleNotices.map((notice) => {
        const messageKey =
          notice.code === 'invalid_transition'
            ? 'worker.sync.transition'
            : notice.code === 'forbidden'
              ? 'worker.sync.forbidden'
              : notice.code === 'not_found'
                ? 'worker.sync.missing'
                : notice.status === 409
                  ? 'worker.sync.conflict'
                  : 'worker.sync.failed';
        return (
          <div className="banner banner-warn flex items-center gap-2" role="alert" key={notice.key}>
            <span className="flex-1">
              {t(messageKey)} · {t(`action.${notice.action}`, notice.action)} · №
              {notice.orderId.slice(0, 8)}
            </span>
            <Link className="btn btn-sm" to={`/worker/orders/${notice.orderId}`}>
              {t('common.refresh')}
            </Link>
            <button
              className="btn btn-sm"
              type="button"
              aria-label={t('common.close')}
              onClick={() => onDismiss(notice.key)}
            >
              ×
            </button>
          </div>
        );
      })}
      {visibleQueue.length > 0 && (
        <div
          className="card flex flex-col gap-2"
          aria-label={t('worker.sync.pending', { count: visibleQueue.length })}
        >
          <div className="flex justify-between items-center gap-2">
            <b>{t('worker.sync.pending', { count: visibleQueue.length })}</b>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              disabled={!online || replaying}
              onClick={onReplay}
            >
              {replaying ? t('common.loading') : t('common.retry')}
            </button>
          </div>
          {lastReplayError && (
            <div className="text-sm text-[var(--ink-muted)]" role="status">
              {lastReplayError}
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {visibleQueue.map((op) => (
              <li key={op.key} className="flex items-center gap-2 text-sm">
                <Link
                  className="flex-1 truncate"
                  to={`/worker/orders/${typeof op.orderId === 'string' ? op.orderId : ''}`}
                >
                  {t(`action.${op.action}`, op.action || t('worker.openOrder'))} ·{' '}
                  {typeof op.orderId === 'string'
                    ? `№${op.orderId.slice(0, 8)}`
                    : t('worker.sync.unknownOrder')}
                </Link>
                <button className="btn btn-sm" type="button" onClick={() => onRemove(op.key)}>
                  {t('worker.sync.delete')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
