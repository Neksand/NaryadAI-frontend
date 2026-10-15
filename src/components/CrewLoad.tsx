import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { listWorkOrders } from '../api/workOrders';
import { catalogList } from '../api/misc';
import { api, toLocalizedError } from '../lib/api-client';
import { pickName, pickPersonName } from '../lib/names';
import type { WorkOrder } from '../types/domain';
import { EmptyState, ErrorState, SkeletonList } from './ui';

export type LoadStatus = 'free' | 'busy' | 'queue' | 'off' | 'unknown';
export type LoadTone = 'ok' | 'danger' | 'warn' | 'neutral';

export interface CrewMember {
  id: string;
  full_name?: string | null;
  name?: string | null;
  login?: string | null;
  current_status?: string | null;
  crew_id?: string | null;
}

export interface CrewRef {
  id: string;
  name?: string | null;
  name_kk?: string | null;
}

export interface CrewGroup {
  crew: CrewRef | null;
  members: CrewMember[];
}

/** Нормализация employees.current_status: неизвестное → 'unknown'. */
export function normalizeWorkerStatus(raw: unknown): LoadStatus {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'free' || s === 'busy' || s === 'queue' || s === 'off') return s;
  return 'unknown';
}

/** Цвет бейджа: зелёный = свободен и готов, красный = занят. */
export function crewStatusTone(status: LoadStatus): LoadTone {
  if (status === 'free') return 'ok';
  if (status === 'busy') return 'danger';
  if (status === 'queue') return 'warn';
  return 'neutral';
}

const ACTIVE = new Set([
  'issued',
  'accepted',
  'queued',
  'in_progress',
  'paused',
  'rework',
  'ai_review',
]);

function unwrapList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const rec = data as { items?: unknown; data?: unknown };
    if (Array.isArray(rec.items)) return rec.items;
    if (Array.isArray(rec.data)) return rec.data;
  }
  return [];
}

/** Группировка людей по бригадам; люди без бригады — в хвост (crew: null). */
export function groupByCrew(workers: CrewMember[], crews: CrewRef[]): CrewGroup[] {
  const memberByCrew = new Map<string, CrewMember[]>();
  const unassigned: CrewMember[] = [];
  for (const w of workers) {
    if (w.crew_id) {
      const list = memberByCrew.get(w.crew_id) ?? [];
      list.push(w);
      memberByCrew.set(w.crew_id, list);
    } else {
      unassigned.push(w);
    }
  }
  const groups: CrewGroup[] = crews.map((crew) => ({
    crew,
    members: memberByCrew.get(crew.id) ?? [],
  }));
  // Бригады, которых нет в справочнике teams, но на них ссылаются люди.
  for (const [crewId, members] of memberByCrew) {
    if (!crews.some((c) => c.id === crewId)) groups.push({ crew: { id: crewId }, members });
  }
  if (unassigned.length > 0) groups.push({ crew: null, members: unassigned });
  return groups;
}

/** Текущий активный наряд человека: личный, иначе — наряд его бригады. */
export function findCurrentOrder(member: CrewMember, orders: WorkOrder[]): WorkOrder | undefined {
  const active = orders.filter((o) => ACTIVE.has(o.status));
  const personal = active.find((o) => o.assignee_id === member.id);
  if (personal) return personal;
  if (member.crew_id) return active.find((o) => o.crew_id === member.crew_id);
  return undefined;
}

export function orderLabel(order: WorkOrder): string {
  const num = order.number ?? order.id.slice(0, 8);
  const what = order.equipment_name ?? order.equipment_id ?? order.description?.slice(0, 40) ?? '';
  return what ? `№${String(num)} · ${what}` : `№${String(num)}`;
}

interface CrewLoadProps {
  workers?: CrewMember[];
  crews?: CrewRef[];
  orders?: WorkOrder[];
}

/**
 * Панель занятости для мастера: каждая бригада → её люди с цветным бейджем
 * статуса и ссылкой на текущий наряд, если человек занят.
 * Без пропсов тянет данные из существующих endpoints: GET /workers,
 * GET /teams, GET /work-orders. С пропсами — чистый рендер (для тестов).
 */
export function CrewLoad(props: CrewLoadProps) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'ru').slice(0, 2);

  const workersQ = useQuery({
    queryKey: ['workers', 'crew-load'],
    queryFn: async () => {
      const { data } = await api.get('/workers');
      return unwrapList(data) as unknown as CrewMember[];
    },
    enabled: props.workers === undefined,
  });
  const crewsQ = useQuery({
    queryKey: ['catalog', 'teams'],
    queryFn: () => catalogList('teams'),
    enabled: props.crews === undefined,
  });
  const ordersQ = useQuery({
    queryKey: ['orders', 'crew-load'],
    queryFn: () => listWorkOrders({ limit: 100 }),
    enabled: props.orders === undefined,
  });

  const workers = useMemo(
    () => props.workers ?? workersQ.data ?? [],
    [props.workers, workersQ.data],
  );
  const crews = useMemo(
    () => (props.crews ?? (crewsQ.data as CrewRef[] | undefined) ?? []) as CrewRef[],
    [props.crews, crewsQ.data],
  );
  const orders = useMemo(
    () => props.orders ?? ordersQ.data?.items ?? [],
    [props.orders, ordersQ.data],
  );

  const fetching =
    props.workers === undefined || props.crews === undefined || props.orders === undefined;
  const pending = fetching && (workersQ.isPending || crewsQ.isPending || ordersQ.isPending);
  const failed = fetching && (workersQ.isError || crewsQ.isError || ordersQ.isError);
  const firstError = workersQ.error ?? crewsQ.error ?? ordersQ.error;
  const refetchAll = () => {
    void workersQ.refetch();
    void crewsQ.refetch();
    void ordersQ.refetch();
  };

  const groups = useMemo(() => groupByCrew(workers, crews), [workers, crews]);

  return (
    <section className="card flex flex-col gap-3" aria-label={t('crewload.title')}>
      <h2 className="font-bold text-[17px]">{t('crewload.title')}</h2>
      {pending ? (
        <SkeletonList rows={3} />
      ) : failed ? (
        <ErrorState
          message={toLocalizedError(firstError).message}
          onRetry={fetching ? refetchAll : undefined}
        />
      ) : groups.length === 0 || groups.every((g) => g.members.length === 0) ? (
        <EmptyState text={t('crewload.empty')} />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            if (g.members.length === 0) return null;
            const free = g.members.filter(
              (m) => normalizeWorkerStatus(m.current_status) === 'free',
            ).length;
            const key = g.crew?.id ?? '__none';
            const crewName = g.crew
              ? pickName(g.crew, lang) || g.crew.name || g.crew.id
              : t('crewload.noCrew');
            return (
              <div key={key} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 justify-between flex-wrap">
                  <span className="font-bold text-sm">{crewName}</span>
                  <span className="text-sm text-[var(--ink-muted)]">
                    {t('crewload.freeOf', { free, total: g.members.length })}
                  </span>
                </div>
                <ul className="flex flex-col gap-2">
                  {g.members.map((m) => {
                    const status = normalizeWorkerStatus(m.current_status);
                    const tone = crewStatusTone(status);
                    const order = findCurrentOrder(m, orders);
                    const personName = pickPersonName(m, lang) || m.id;
                    return (
                      <li key={m.id} className="flex items-center gap-2 justify-between flex-wrap">
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                            data-testid={`crewload-dot-${m.id}`}
                            data-tone={tone}
                            aria-hidden="true"
                            style={{
                              backgroundColor:
                                tone === 'ok'
                                  ? 'var(--ok)'
                                  : tone === 'danger'
                                    ? 'var(--danger)'
                                    : tone === 'warn'
                                      ? 'var(--warn)'
                                      : 'var(--ink-muted)',
                            }}
                          />
                          <span className="font-semibold truncate">{personName}</span>
                          <span className={`chip ${tone}`}>
                            {status === 'free'
                              ? t('crewload.ready')
                              : status === 'unknown'
                                ? (m.current_status ?? '—')
                                : t(`empStatus.${status}`)}
                          </span>
                        </span>
                        {order && (
                          <Link
                            to={`/master/orders/${order.id}`}
                            className="text-sm underline truncate"
                            aria-label={`${t('order.title')} ${order.number ?? order.id.slice(0, 8)}`}
                          >
                            {orderLabel(order)}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
