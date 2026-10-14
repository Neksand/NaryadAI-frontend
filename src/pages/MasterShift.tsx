import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { shiftBoard, listWorkOrders } from '../api/workOrders';
import { Shell, roleTabs } from '../components/Shell';
import { ErrorState, OrderCard, SkeletonList } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';
import { Icon } from '../components/Icon';

const TEAM_PAGE = 12;

export default function MasterShift() {
  const { t } = useTranslation();
  // Живые обновления идут по WebSocket (Shell/useRealtime) — поллинг не нужен.
  const board = useQuery({ queryKey: ['board'], queryFn: () => shiftBoard() });
  const overdue = useQuery({
    queryKey: ['orders', 'overdue'],
    queryFn: () => listWorkOrders({ overdue: true, limit: 20 }),
  });
  const active = useQuery({
    queryKey: ['orders', 'master-active'],
    queryFn: () => listWorkOrders({ limit: 30 }),
  });
  const [teamShown, setTeamShown] = useState(TEAM_PAGE);

  const counters =
    (board.data as { counters?: Record<string, number> } | undefined)?.counters ?? {};
  const employees =
    (
      board.data as
        | {
            employees?: {
              id: string;
              name: string;
              status: string;
              current_order?: string;
              queue_count?: number;
            }[];
          }
        | undefined
    )?.employees ?? [];

  const refreshAll = () => {
    void board.refetch();
    void overdue.refetch();
    void active.refetch();
  };

  return (
    <Shell title={t('master.shift')} tabs={roleTabs(t, 'master')}>
      <div className="flex justify-end">
        <button
          type="button"
          className="fchip"
          onClick={refreshAll}
          aria-label={t('common.refresh')}
        >
          <Icon name="refresh" size={16} /> {t('common.refresh')}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label={t('master.shift')}>
        <Link to="/master/board" className="kpi">
          <div className="v num">{counters.issued ?? '—'}</div>
          <div className="l">{t('master.issued')}</div>
        </Link>
        <Link to="/master/board" className="kpi">
          <div className="v num">{counters.done ?? '—'}</div>
          <div className="l">{t('master.doneToday')}</div>
        </Link>
        <Link to="/master/board?filter=overdue" className="kpi danger">
          <div className="v num">{counters.overdue ?? overdue.data?.items.length ?? '—'}</div>
          <div className="l">{t('master.overdue')}</div>
        </Link>
        <div className="kpi">
          <div className="v num">{counters.equipment_down ?? '—'}</div>
          <div className="l">{t('master.down')}</div>
        </div>
      </div>

      <section>
        <div className="flex justify-between items-center mb-2">
          <h2 className="sec-h !mb-0">{t('master.overdue')}</h2>
          <Link
            className="btn btn-sm"
            to="/master/board?filter=overdue"
            aria-label={t('master.overdue')}
          >
            <Icon name="arrowRight" size={16} />
          </Link>
        </div>
        {overdue.isPending ? (
          <SkeletonList rows={2} />
        ) : overdue.isError ? (
          <ErrorState
            message={toLocalizedError(overdue.error).message}
            onRetry={() => overdue.refetch()}
          />
        ) : (overdue.data?.items ?? []).length === 0 ? (
          <div className="card text-[var(--ink-muted)]">{t('common.empty')}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {(overdue.data?.items ?? []).slice(0, 5).map((o) => (
              <OrderCard key={o.id} order={o} to={`/master/orders/${o.id}`} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="sec-h">{t('master.ordersTitle')}</h2>
        {active.isPending ? (
          <SkeletonList />
        ) : active.isError ? (
          <ErrorState
            message={toLocalizedError(active.error).message}
            onRetry={() => active.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {(active.data?.items ?? []).slice(0, 10).map((o) => (
              <OrderCard key={o.id} order={o} to={`/master/orders/${o.id}`} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="sec-h">
          {t('master.performers')} ({employees.length})
        </h2>
        <div className="flex flex-col gap-2">
          {employees.slice(0, teamShown).map((e) => (
            <div key={e.id} className="card !p-3 flex items-center gap-3">
              <span className="chip neutral">{t(`empStatus.${e.status}`, e.status)}</span>
              <span className="font-semibold">{e.name}</span>
              {typeof e.queue_count === 'number' && (
                <span className="mono text-[var(--ink-muted)] ml-auto">×{e.queue_count}</span>
              )}
            </div>
          ))}
        </div>
        {employees.length > teamShown && (
          <button
            type="button"
            className="btn btn-sm mt-2"
            onClick={() => setTeamShown((n) => n + TEAM_PAGE)}
          >
            {t('common.more')} ({employees.length - teamShown})
          </button>
        )}
      </section>

      <div className="dock-sticky">
        <Link
          to="/master/new"
          className="btn btn-primary btn-xl btn-block"
          aria-label={t('master.newOrder')}
        >
          + {t('master.newOrder')}
        </Link>
      </div>
    </Shell>
  );
}
