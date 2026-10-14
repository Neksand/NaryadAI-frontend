import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listNotifications, markAllRead, markRead } from '../api/misc';
import { Shell } from '../components/Shell';
import { EmptyState, ErrorState, SkeletonList } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';
import { formatDT } from '../lib/dates';
import { Icon } from '../components/Icon';

export default function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Обновления идут по WebSocket — поллинг не нужен.
  const q = useQuery({
    queryKey: ['notifications', 'all'],
    queryFn: () => listNotifications(false),
  });
  const read = useMutation({
    mutationFn: (id: string) => markRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const readAll = useMutation({
    mutationFn: () => markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <Shell title={t('nav.notifications')}>
      <button
        className="btn btn-sm self-end"
        onClick={() => readAll.mutate()}
        disabled={readAll.isPending}
      >
        <Icon name="checkAll" size={16} /> {t('notif.readAll')}
      </button>
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState message={toLocalizedError(q.error).message} onRetry={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState text={t('common.empty')} />
      ) : (
        <div className="flex flex-col gap-2">
          {q.data.map((n) => (
            <button
              key={n.id}
              className="card !p-3 text-left"
              style={{ opacity: n.is_read ? 0.65 : 1 }}
              onClick={() => {
                if (!n.is_read) read.mutate(n.id);
              }}
            >
              <div className="flex gap-2 items-center">
                <span className="chip ai">{t(`notif.${n.type}`, n.type)}</span>
                <span className="mono text-xs text-[var(--ink-muted)]">
                  {n.created_at ? formatDT(n.created_at) : ''}
                </span>
              </div>
              <div className="font-semibold mt-1">{n.title ?? t(`notif.${n.type}`, n.type)}</div>
              {n.body && <div className="text-sm text-[var(--ink-muted)]">{n.body}</div>}
            </button>
          ))}
        </div>
      )}
    </Shell>
  );
}
