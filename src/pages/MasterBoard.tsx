import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { listWorkOrders } from '../api/workOrders';
import { Shell } from '../components/Shell';
import { ErrorState, OrderCard, SkeletonList } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';
import type { WorkOrderStatus } from '../types/domain';

const COLS: { key: WorkOrderStatus | 'overdue'; label: string }[] = [
  { key: 'issued', label: 'status.issued' },
  { key: 'accepted', label: 'status.accepted' },
  { key: 'in_progress', label: 'status.in_progress' },
  { key: 'paused', label: 'status.paused' },
  { key: 'ai_review', label: 'status.ai_review' },
  { key: 'overdue', label: 'status.overdue' },
];

export default function MasterBoard() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [status, setStatus] = useState('');
  const filter = params.get('filter');

  const q = useQuery({
    queryKey: ['orders', 'board', status, filter],
    queryFn: () => listWorkOrders({ status: status || undefined, overdue: filter === 'overdue' ? true : undefined, limit: 100 }),
    refetchInterval: 10000,
  });

  const groups = useMemo(() => {
    const items = q.data?.items ?? [];
    const by = (s: string) => items.filter((o) => o.status === s);
    return {
      issued: by('issued'), accepted: by('accepted'), in_progress: by('in_progress'),
      paused: [...by('paused'), ...by('rework')], ai_review: by('ai_review'),
      overdue: items.filter((o) => o.is_overdue),
    } as Record<string, typeof items>;
  }, [q.data]);

  return (
    <Shell title={t('nav.board')} tabs={[{ to: '/master', label: t('master.shift') }, { to: '/master/board', label: t('nav.board') }]}>
      <div className="flex gap-2 flex-wrap" role="search">
        <select className="input !w-auto !min-h-[40px]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('master.ordersTitle')}>
          <option value="">—</option>
          {(['issued', 'accepted', 'in_progress', 'paused', 'ai_review', 'rework', 'closed'] as WorkOrderStatus[]).map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
        <Link to="/master/new" className="btn btn-primary btn-sm">+ {t('master.newOrder')}</Link>
        {q.data?.next_cursor && <span className="chip neutral">{t('common.next')}</span>}
      </div>

      {q.isPending ? <SkeletonList rows={4} /> :
        q.isError ? <ErrorState message={toLocalizedError(q.error).message} onRetry={() => q.refetch()} /> :
        (
          <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-3">
            {COLS.map((c) => (
              <section key={c.key} className="card !bg-[var(--surface-300)] flex flex-col gap-2" aria-label={t(c.label)}>
                <h3 className="font-bold text-sm">{t(c.label)} ({groups[c.key]?.length ?? 0})</h3>
                {(groups[c.key] ?? []).slice(0, 12).map((o) => <OrderCard key={o.id} order={o} to={`/master/orders/${o.id}`} />)}
              </section>
            ))}
          </div>
        )}
    </Shell>
  );
}
