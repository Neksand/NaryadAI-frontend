import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { myWorkOrders, transitionOrder } from '../api/workOrders';
import { listNotifications } from '../api/misc';
import { Shell, roleTabs } from '../components/Shell';
import { EmptyState, ErrorState, OrderCard, SkeletonList } from '../components/ui';
import { newUUID, toLocalizedError } from '../lib/api-client';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { WorkerOrderCard } from '../components/WorkerOrderCard';
import { OfflineQueuePanel } from '../components/OfflineQueuePanel';
import { urgencyCompare } from '../lib/deadline';
import { playNewOrderSound } from '../lib/notifications';
import { Icon } from '../components/Icon';

type Filter = 'all' | 'urgent' | 'queue';

const HISTORY_PAGE = 10;

export default function WorkerHome() {
  const { t } = useTranslation();
  const offline = useOfflineQueue();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [historyShown, setHistoryShown] = useState(HISTORY_PAGE);
  const [now, setNow] = useState(Date.now());
  const [newOrder, setNewOrder] = useState<{ id: string; number?: number } | null>(null);
  const active = useQuery({
    queryKey: ['orders', 'my', 'active'],
    queryFn: () => myWorkOrders('active'),
    networkMode: 'always',
  });
  const history = useQuery({
    queryKey: ['orders', 'my', 'history'],
    queryFn: () => myWorkOrders('history'),
    networkMode: 'always',
  });
  const notif = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications(true),
    networkMode: 'always',
  });
  const quickAction = useMutation({
    // Offline-мутации обязаны выполняться и без сети, иначе TanStack ставит их на паузу
    // (networkMode online по умолчанию) и постановка в очередь никогда не происходит.
    networkMode: 'always',
    mutationFn: async ({ orderId, action }: { orderId: string; action: string }) => {
      const isOffline =
        !offline.online || (typeof navigator !== 'undefined' && navigator.onLine === false);
      if (isOffline) {
        await offline.enqueue({
          key: newUUID(),
          orderId,
          action,
          body: {},
          clientAt: new Date().toISOString(),
        });
        return { queued: true };
      }
      return transitionOrder(orderId, action, {}, newUUID());
    },
    onSuccess: (_data, vars) => {
      const isOfflineNow =
        !offline.online || (typeof navigator !== 'undefined' && navigator.onLine === false);
      if (isOfflineNow) return;
      void qc.invalidateQueries({ queryKey: ['orders', 'my'] });
      void qc.invalidateQueries({ queryKey: ['order', vars.orderId] });
    },
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const onNewOrder = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; number?: number }>).detail;
      if (!detail?.id) return;
      setNewOrder({ id: detail.id, number: detail.number });
      void active.refetch();
      void playNewOrderSound();
    };
    window.addEventListener('naryadai:work-order-created', onNewOrder);
    return () => window.removeEventListener('naryadai:work-order-created', onNewOrder);
  }, [active.refetch]);

  const all = active.data ?? [];
  const isOverdue = (o: (typeof all)[number]) =>
    o.is_overdue || Boolean(o.due_at && Date.parse(o.due_at) <= now);
  const urgent = all.filter(
    (o) => o.priority === 'critical' || o.priority === 'high' || isOverdue(o),
  );
  const queue = all.filter((o) => o.status === 'queued');
  const visible = (filter === 'urgent' ? urgent : filter === 'queue' ? queue : all)
    .slice()
    .sort((a, b) => urgencyCompare(a, b, now));
  const unread = (notif.data ?? []).length;

  const refreshAll = () => {
    void active.refetch();
    void history.refetch();
  };

  return (
    <Shell title={t('nav.orders')} tabs={roleTabs(t, 'worker', unread)}>
      {!offline.online && (
        <div className="banner banner-warn" role="status">
          {t('common.offline')} · {t('worker.sync.snapshot')} · {offline.count} {t('common.queued')}
        </div>
      )}
      {newOrder && (
        <div className="banner banner-ai flex items-center gap-2" role="status">
          <span className="flex-1">
            {t('worker.newOrder', { number: newOrder.number ?? newOrder.id.slice(0, 8) })}
          </span>
          <Link
            className="btn btn-sm btn-primary"
            to={`/worker/orders/${newOrder.id}`}
            onClick={() => setNewOrder(null)}
          >
            {t('worker.openOrder')}
          </Link>
          <button
            className="btn btn-sm"
            type="button"
            aria-label={t('common.close')}
            onClick={() => setNewOrder(null)}
          >
            ×
          </button>
        </div>
      )}
      <OfflineQueuePanel
        queue={offline.queue}
        notices={offline.notices ?? []}
        online={offline.online}
        replaying={offline.replaying}
        lastReplayError={offline.lastReplayError}
        onReplay={() => void offline.replay()}
        onRemove={(key) => void offline.remove(key)}
        onDismiss={(key) => void offline.dismissNotice(key)}
      />

      <div className="filters" role="tablist" aria-label={t('nav.orders')}>
        {(['all', 'urgent', 'queue'] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            type="button"
            className={`fchip ${filter === f ? 'on' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all'
              ? `${t('worker.active')} (${all.length})`
              : f === 'urgent'
                ? `${t('worker.urgent')} (${urgent.length})`
                : `${t('worker.queue')} (${queue.length})`}
          </button>
        ))}
        <button
          type="button"
          className="fchip"
          onClick={refreshAll}
          aria-label={t('common.refresh')}
        >
          <Icon name="refresh" size={16} /> {t('common.refresh')}
        </button>
      </div>

      <section aria-label={t('worker.active')}>
        {active.isPending ? (
          <SkeletonList />
        ) : active.isError ? (
          <ErrorState
            message={toLocalizedError(active.error).message}
            onRetry={() => active.refetch()}
          />
        ) : visible.length === 0 ? (
          <EmptyState text={t('common.empty')} />
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((o) => (
              <WorkerOrderCard
                key={o.id}
                order={o}
                quickActionPending={quickAction.isPending}
                queued={offline.queue.some(
                  (op) => op.orderId === o.id && op.action === o.allowed_actions[0],
                )}
                onQuickAction={(order, action) => quickAction.mutate({ orderId: order.id, action })}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-label={t('worker.done')}>
        <h2 className="font-bold text-[17px] mb-2">{t('worker.done')}</h2>
        {history.isPending ? (
          <SkeletonList rows={2} />
        ) : history.isError ? (
          <ErrorState
            message={toLocalizedError(history.error).message}
            onRetry={() => history.refetch()}
          />
        ) : (history.data ?? []).length === 0 ? (
          <EmptyState text={t('common.empty')} />
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {(history.data ?? []).slice(0, historyShown).map((o) => (
                <OrderCard key={o.id} order={o} to={`/worker/orders/${o.id}`} />
              ))}
            </div>
            {(history.data ?? []).length > historyShown && (
              <button
                type="button"
                className="btn btn-sm mt-2 self-center"
                onClick={() => setHistoryShown((n) => n + HISTORY_PAGE)}
              >
                {t('common.more')} ({(history.data ?? []).length - historyShown})
              </button>
            )}
          </>
        )}
      </section>
    </Shell>
  );
}
