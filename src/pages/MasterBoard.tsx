import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { listWorkOrders } from '../api/workOrders';
import { Shell, roleTabs } from '../components/Shell';
import { EmptyState, ErrorState, OrderCard, SkeletonList } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';
import type { WorkOrderStatus } from '../types/domain';
import { Icon } from '../components/Icon';

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
  // Складные колонки: пустые можно скрыть, состояние запоминается.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('naryadai.board-open') ?? '{}') as Record<
        string,
        boolean
      >;
    } catch {
      return {};
    }
  });
  const isOpen = (k: string) => open[k] ?? true;
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = { ...o, [k]: !(o[k] ?? true) };
      try {
        localStorage.setItem('naryadai.board-open', JSON.stringify(n));
      } catch {
        /* ignore */
      }
      return n;
    });

  const q = useQuery({
    queryKey: ['orders', 'board', status, filter],
    queryFn: () =>
      listWorkOrders({
        status: status || undefined,
        overdue: filter === 'overdue' ? true : undefined,
        limit: 100,
      }),
  });

  const groups = useMemo(() => {
    const items = q.data?.items ?? [];
    const by = (s: string) => items.filter((o) => o.status === s);
    return {
      issued: by('issued'),
      accepted: by('accepted'),
      in_progress: by('in_progress'),
      paused: [...by('paused'), ...by('rework')],
      ai_review: by('ai_review'),
      overdue: items.filter((o) => o.is_overdue),
    } as Record<string, typeof items>;
  }, [q.data]);

  return (
    <Shell title={t('nav.board')} tabs={roleTabs(t, 'master')}>
      <div className="flex gap-2 flex-wrap" role="search">
        <select
          className="input !w-auto !min-h-[40px]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('master.ordersTitle')}
        >
          <option value="">—</option>
          {(
            [
              'issued',
              'accepted',
              'in_progress',
              'paused',
              'ai_review',
              'rework',
              'closed',
            ] as WorkOrderStatus[]
          ).map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <Link to="/master/new" className="btn btn-primary btn-sm">
          + {t('master.newOrder')}
        </Link>
        {q.data?.next_cursor && <span className="chip neutral">{t('common.next')}</span>}
      </div>

      {q.isPending ? (
        <SkeletonList rows={4} />
      ) : q.isError ? (
        <ErrorState message={toLocalizedError(q.error).message} onRetry={() => q.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          {COLS.map((c) => (
            <section
              key={c.key}
              className="card !bg-[var(--surface-300)] flex flex-col gap-2"
              aria-label={t(c.label)}
            >
              <button
                type="button"
                onClick={() => toggle(c.key)}
                aria-expanded={isOpen(c.key)}
                className="flex items-center gap-2 w-full text-left font-bold text-sm"
              >
                <Icon name={isOpen(c.key) ? 'chevD' : 'chevU'} size={18} />
                <span>
                  {t(c.label)} ({groups[c.key]?.length ?? 0})
                </span>
              </button>
              {isOpen(c.key) &&
                (groups[c.key] ?? [])
                  .slice(0, 12)
                  .map((o) => <OrderCard key={o.id} order={o} to={`/master/orders/${o.id}`} />)}
              {isOpen(c.key) && (groups[c.key] ?? []).length === 0 && (
                <EmptyState text={t('common.empty')} />
              )}
            </section>
          ))}
        </div>
      )}
    </Shell>
  );
}
