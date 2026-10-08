import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { myWorkOrders } from '../api/workOrders';
import { listNotifications } from '../api/misc';
import { Shell } from '../components/Shell';
import { EmptyState, ErrorState, OrderCard, SkeletonList } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

export default function WorkerHome() {
  const { t } = useTranslation();
  const { count: queued, online } = useOfflineQueue();
  const active = useQuery({ queryKey: ['orders', 'my', 'active'], queryFn: () => myWorkOrders('active') });
  const history = useQuery({ queryKey: ['orders', 'my', 'history'], queryFn: () => myWorkOrders('history') });
  const notif = useQuery({ queryKey: ['notifications'], queryFn: () => listNotifications(true) });

  const urgent = (active.data ?? []).filter((o) => o.priority === 'critical' || o.is_overdue);
  const unread = (notif.data ?? []).length;

  return (
    <Shell
      title={t('nav.orders')}
      tabs={[
        { to: '/worker', label: t('nav.orders') },
        { to: '/notifications', label: t('nav.notifications'), badge: unread || undefined },
        { to: '/worker/history', label: t('worker.done') },
      ]}
    >
      {!online && <div className="banner banner-warn" role="status">{t('common.offline')} · {queued} {t('common.queued')}</div>}

      <section aria-label={t('worker.urgent')}>
        <h2 className="font-bold text-[17px] mb-2">{t('worker.urgent')} ({urgent.length})</h2>
        {active.isPending ? <SkeletonList /> :
          active.isError ? <ErrorState message={toLocalizedError(active.error).message} onRetry={() => active.refetch()} /> :
          urgent.length === 0 ? <EmptyState text={t('common.empty')} /> :
          <div className="flex flex-col gap-3">{urgent.map((o) => <OrderCard key={o.id} order={o} to={`/worker/orders/${o.id}`} />)}</div>}
      </section>

      <section aria-label={t('worker.active')}>
        <h2 className="font-bold text-[17px] mb-2">{t('worker.active')}</h2>
        {active.isPending ? <SkeletonList /> :
          active.isError ? <ErrorState message={toLocalizedError(active.error).message} onRetry={() => active.refetch()} /> :
          (active.data ?? []).length === 0 ? <EmptyState text={t('common.empty')} /> :
          <div className="flex flex-col gap-3">{(active.data ?? []).map((o) => <OrderCard key={o.id} order={o} to={`/worker/orders/${o.id}`} />)}</div>}
      </section>

      <section aria-label={t('worker.done')}>
        <h2 className="font-bold text-[17px] mb-2">{t('worker.done')}</h2>
        {history.isPending ? <SkeletonList rows={2} /> :
          history.isError ? <ErrorState message={toLocalizedError(history.error).message} onRetry={() => history.refetch()} /> :
          (history.data ?? []).length === 0 ? <EmptyState text={t('common.empty')} /> :
          <div className="flex flex-col gap-3">{(history.data ?? []).slice(0, 10).map((o) => <OrderCard key={o.id} order={o} to={`/worker/orders/${o.id}`} />)}</div>}
      </section>
    </Shell>
  );
}
