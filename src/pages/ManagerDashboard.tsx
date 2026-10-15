import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  analyticsGet,
  exportReport,
  exportStatus,
  type ReportExportStatus,
  type ReportFormat,
  type ReportType,
} from '../api/misc';
import { planOrderFromInsight } from '../api/ai';
import { Shell, roleTabs } from '../components/Shell';
import { ForecastPanel } from '../components/ForecastPanel';
import { EconomicsWhatIf } from '../components/EconomicsWhatIf';
import { InsightEvidence } from '../components/OrderEvidence';
import { AITag, ErrorState, SkeletonList } from '../components/ui';
import { toLocalizedError, newUUID } from '../lib/api-client';
import { pickName } from '../lib/names';
import { Icon } from '../components/Icon';

interface Insight {
  id: string;
  title?: string;
  headline?: string;
  headline_kk?: string;
  severity?: string;
  confidence?: number;
  explanation?: string;
  recommendation?: string;
  recommendation_kk?: string;
  order_ids?: unknown;
  evidence?: unknown;
  denominator?: unknown;
  formula?: unknown;
  count?: unknown;
}

/** Карточка инсайта: выбор исполнителя + создание планового наряда (раньше уходило без assignee → 422 молча). */
interface WorkerOption {
  id: string;
  full_name?: string;
  name?: string;
}
function InsightCard({
  ins,
  lang,
  workers,
}: {
  ins: Insight;
  lang: string;
  workers: WorkerOption[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [assignee, setAssignee] = useState('');
  const plan = useMutation({
    mutationFn: () =>
      planOrderFromInsight(
        ins.id,
        { assignee_id: assignee, due_at: new Date(Date.now() + 86400000).toISOString() },
        newUUID(),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['analytics', 'insights'] });
    },
  });
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <span className={`chip ${ins.severity === 'critical' ? 'danger' : 'warn'}`}>
          {t(`severity.${ins.severity ?? 'info'}`, ins.severity ?? 'info')}
        </span>
        <b>
          {lang === 'kk'
            ? ins.headline_kk || ins.headline || ins.title || ins.id
            : ins.headline || ins.title || ins.id}
        </b>
      </div>
      <AITag
        confidence={ins.confidence}
        explanation={
          lang === 'kk'
            ? ins.recommendation_kk || ins.recommendation || ins.explanation
            : (ins.explanation ?? ins.recommendation)
        }
      />
      <InsightEvidence insight={ins} />
      {plan.isSuccess ? (
        <div className="banner banner-ai" role="status">
          <Icon name="check" size={16} /> {t('analytics.plannedOk')}
        </div>
      ) : (
        <div className="flex gap-2 items-center flex-wrap">
          <select
            className="input !w-auto grow"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            aria-label={t('analytics.pickWorker')}
          >
            <option value="">— {t('analytics.pickWorker')}</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {pickName(w as { name?: string; name_kk?: string }, lang) ||
                  w.full_name ||
                  w.name ||
                  w.id}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm btn-ai"
            disabled={!assignee || plan.isPending}
            onClick={() => plan.mutate()}
          >
            {plan.isPending ? t('common.loading') : t('analytics.planOrder')}
          </button>
        </div>
      )}
      {plan.isError && (
        <ErrorState message={toLocalizedError(plan.error).message} onRetry={() => plan.mutate()} />
      )}
    </div>
  );
}

function useAnalytics(path: string, params: Record<string, string> = {}) {
  return useQuery({
    queryKey: ['analytics', path, JSON.stringify(params)],
    queryFn: () => analyticsGet(path, params),
  });
}

type Row = Record<string, unknown>;
function asRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data as Row[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    // Бэкенд миксует конверты: {"items": [...]}, {"data": [...]}, {"kpis": {...}}
    if (Array.isArray(o.items)) return o.items as Row[];
    if (Array.isArray(o.data)) return o.data as Row[];
    for (const v of Object.values(o))
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v as Row[];
  }
  return [];
}
/** Подписи известных ключей аналитики; неизвестные показываем как есть. */
function colLabel(t: TFunction, c: string): string {
  return t(`metric.${c}`, c);
}
/** Значения-перечисления переводим, остальное форматируем. */
function cellText(t: TFunction, col: string, v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? t('metric.yes', 'Да') : t('metric.no', 'Нет');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  if (col === 'status') return t(`status.${s}`, s);
  if (col === 'priority') return t(`priority.${s}`, s);
  if (col === 'severity') return t(`severity.${s}`, s);
  if (col === 'kind') return t(`kind.${s}`, s);
  if (col === 'role') return t(`role.${s}`, s);
  return s;
}

/** Generic drill-down table: renders any analytics list defensively. */
function SectionTable({ data, linkPrefix }: { data: unknown; linkPrefix?: string }) {
  const { t } = useTranslation();
  const rows = asRows(data).slice(0, 20);
  if (!rows.length) return <div className="card text-[var(--ink-muted)]">{t('common.empty')}</div>;
  const cols = Object.keys(rows[0] ?? {})
    .filter((k) => !/id$/i.test(k) || k === 'employee_id')
    .slice(0, 6);
  const idKey = ['id', 'area_id', 'employee_id', 'equipment_id'].find((k) => k in (rows[0] ?? {}));
  return (
    <div className="card overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{colLabel(t, c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r[idKey ?? ''] ?? i)}>
              {cols.map((c) => (
                <td
                  key={c}
                  data-label={colLabel(t, c)}
                  className={typeof r[c] === 'number' ? 'num' : ''}
                >
                  {linkPrefix && idKey && c === cols[0] && r[idKey] ? (
                    <Link className="text-[var(--brand)]" to={`${linkPrefix}${String(r[idKey])}`}>
                      {cellText(t, c, r[c])}
                    </Link>
                  ) : (
                    cellText(t, c, r[c])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsSection({ path, title }: { path: string; title: string }) {
  const q = useAnalytics(path);
  if (q.isPending)
    return (
      <section aria-label={path}>
        <h2 className="font-bold text-[17px] mb-2">{title}</h2>
        <SkeletonList rows={2} />
      </section>
    );
  if (q.isError)
    return (
      <section aria-label={path}>
        <h2 className="font-bold text-[17px] mb-2">{title}</h2>
        <ErrorState message={toLocalizedError(q.error).message} onRetry={() => q.refetch()} />
      </section>
    );
  return (
    <section aria-label={path}>
      <h2 className="font-bold text-[17px] mb-2">{title}</h2>
      <SectionTable data={q.data} />
    </section>
  );
}

const TABS = [
  { key: 'overview', labelKey: 'analytics.overview' },
  { key: 'areas', labelKey: 'analytics.areas', path: 'areas' },
  { key: 'equipment', labelKey: 'analytics.equipment', path: 'equipment/ranking' },
  { key: 'materials', labelKey: 'analytics.materials', path: 'materials' },
  { key: 'downtime', labelKey: 'analytics.downtime', path: 'downtime' },
  { key: 'quality', labelKey: 'analytics.qualityTab', path: 'quality' },
] as const;

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'orders', label: 'orders' },
  { value: 'shift', label: 'shift' },
  { value: 'ratings', label: 'ratings' },
  { value: 'materials', label: 'materials' },
  { value: 'downtime', label: 'downtime' },
  { value: 'dashboard', label: 'dashboard' },
];

function dateFilter(from: string, to: string) {
  const filters: { from?: string; to?: string } = {};
  if (from) filters.from = `${from}T00:00:00.000Z`;
  if (to) {
    const exclusiveEnd = new Date(`${to}T00:00:00.000Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    filters.to = exclusiveEnd.toISOString();
  }
  return filters;
}

export function ReportExportPanel() {
  const { t } = useTranslation();
  const [type, setType] = useState<ReportType>('orders');
  const [format, setFormat] = useState<ReportFormat>('xlsx');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => exportReport({ type, format, filters: dateFilter(from, to) }),
    onSuccess: ({ job_id }) => setJobId(job_id),
  });
  const status = useQuery<ReportExportStatus>({
    queryKey: ['report-export', jobId],
    queryFn: () => exportStatus(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: ({ state }) => {
      const current = state.data?.status;
      return current === 'completed' || current === 'failed' ? false : 1500;
    },
  });

  const running =
    create.isPending || status.data?.status === 'queued' || status.data?.status === 'processing';
  const requestError = create.isError ? toLocalizedError(create.error).message : null;
  const statusError = status.isError ? toLocalizedError(status.error).message : null;
  return (
    <section className="card flex flex-col gap-3" aria-label={t('reports.title')}>
      <div>
        <h2 className="font-bold text-[17px]">{t('reports.title')}</h2>
        <p className="text-sm text-[var(--ink-muted)]">{t('reports.description')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t('reports.type')}
          <select
            className="input"
            value={type}
            onChange={(event) => setType(event.target.value as ReportType)}
          >
            {REPORT_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {t(`reports.types.${item.label}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('reports.format')}
          <select
            className="input"
            value={format}
            onChange={(event) => setFormat(event.target.value as ReportFormat)}
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('reports.from')}
          <input
            className="input"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('reports.to')}
          <input
            className="input"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="btn btn-primary"
          type="button"
          disabled={running || (from !== '' && to !== '' && from > to)}
          onClick={() => create.mutate()}
        >
          {running ? t('reports.working') : t('reports.create')}
        </button>
        {status.data?.status === 'queued' && <span role="status">{t('reports.queued')}</span>}
        {status.data?.status === 'processing' && (
          <span role="status">{t('reports.processing')}</span>
        )}
        {status.data?.status === 'completed' && status.data.url && (
          <a className="btn btn-sm" href={status.data.url} target="_blank" rel="noreferrer">
            {t('reports.download')}
          </a>
        )}
        {status.data?.status === 'completed' && !status.data.url && (
          <span role="status">{t('reports.completeWithoutLink')}</span>
        )}
        {status.data?.status === 'failed' && (
          <span className="text-[var(--danger)]" role="alert">
            {status.data.error || t('reports.failed')}
          </span>
        )}
        {statusError && (
          <span className="text-[var(--danger)]" role="alert">
            {statusError}
          </span>
        )}
        {statusError && (
          <button type="button" className="btn btn-sm" onClick={() => void status.refetch()}>
            {t('common.retry')}
          </button>
        )}
        {requestError && (
          <span className="text-[var(--danger)]" role="alert">
            {requestError}
          </span>
        )}
        {create.isError && (
          <button type="button" className="btn btn-sm" onClick={() => create.mutate()}>
            {t('common.retry')}
          </button>
        )}
      </div>
    </section>
  );
}

export default function ManagerDashboard() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'ru').slice(0, 2);
  const [params, setParams] = useSearchParams();
  const loc = useLocation();
  const tab =
    params.get('tab') ??
    (loc.pathname.endsWith('/areas')
      ? 'areas'
      : loc.pathname.endsWith('/equipment')
        ? 'equipment'
        : 'overview');

  const setTab = (key: string) => setParams(key === 'overview' ? {} : { tab: key });
  const dash = useAnalytics('dashboard');
  const trends = useAnalytics('trends', { days: '30' });
  const insights = useAnalytics('insights');
  const ratings = useAnalytics('ratings');
  // Один запрос на всех: раньше каждая карточка инсайта дергала GET /workers отдельно.
  const workers = useQuery({
    queryKey: ['workers', 'insight'],
    queryFn: async () => {
      const { api } = await import('../lib/api-client');
      const { data } = await api.get('/workers');
      return (Array.isArray(data) ? data : (data.items ?? data.data ?? [])) as WorkerOption[];
    },
    staleTime: 60000,
  });

  const d = (dash.data ?? {}) as {
    kpis?: Record<string, number>;
    total?: number;
    on_time_pct?: number;
  };
  const kpis = d.kpis ?? d;
  const insightItems = ((insights.data as { items?: unknown[]; data?: unknown[] })?.items ??
    (insights.data as { data?: unknown[] })?.data ??
    (Array.isArray(insights.data) ? insights.data : [])) as Insight[];
  const ratingItems = ((ratings.data as { items?: unknown[]; data?: unknown[] })?.items ??
    (ratings.data as { data?: unknown[] })?.data ??
    []) as {
    id: string;
    name?: string;
    rating: number;
    closed: number;
    total: number;
    quality: number;
    on_time: number;
    rework_rate: number;
    volume: number;
    rejected: number;
    low_data: boolean;
  }[];

  return (
    <Shell title={t('nav.analytics')} tabs={roleTabs(t, 'manager')}>
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label={t('nav.analytics')}>
        {TABS.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={tab === x.key}
            className={`btn btn-sm ${tab === x.key ? 'btn-primary' : ''}`}
            onClick={() => setTab(x.key)}
          >
            {t(x.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <ReportExportPanel />
          <ForecastPanel limit={5} />
          <EconomicsWhatIf />
          {dash.isPending ? (
            <SkeletonList rows={2} />
          ) : dash.isError ? (
            <ErrorState
              message={toLocalizedError(dash.error).message}
              onRetry={() => dash.refetch()}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {Object.entries(kpis)
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <div key={k} className="kpi">
                      <div className="v num">{typeof v === 'number' ? v : String(v)}</div>
                      <div className="l">{colLabel(t, k)}</div>
                    </div>
                  ))}
              </div>
            </>
          )}

          <section aria-label={t('analytics.trend')}>
            <h2 className="sec-h">{t('analytics.trend')}</h2>
            {trends.isPending ? (
              <SkeletonList rows={1} />
            ) : trends.isError ? (
              <ErrorState
                message={toLocalizedError(trends.error).message}
                onRetry={() => void trends.refetch()}
              />
            ) : (
              (() => {
                const rows = asRows(trends.data).map((row) => ({
                  day: String(row.day ?? ''),
                  created: Number(row.created ?? 0),
                  closed: Number(row.closed ?? 0),
                }));
                if (!rows.length)
                  return <div className="card text-[var(--ink-muted)]">{t('common.empty')}</div>;
                return (
                  <div className="card">
                    <div style={{ height: 250 }} role="img" aria-label={t('analytics.trend')}>
                      <ResponsiveContainer>
                        <BarChart data={rows}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="day" fontSize={12} />
                          <YAxis fontSize={12} allowDecimals={false} />
                          <Tooltip />
                          <Legend />
                          <Bar
                            dataKey="created"
                            name={t('metric.created')}
                            fill="var(--chart-1)"
                            radius={[5, 5, 0, 0]}
                          />
                          <Bar
                            dataKey="closed"
                            name={t('metric.closed')}
                            fill="var(--chart-2)"
                            radius={[5, 5, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()
            )}
          </section>

          <section>
            <h2 className="sec-h">
              {t('analytics.insights')} ({insightItems.length})
            </h2>
            {insights.isPending ? (
              <SkeletonList rows={2} />
            ) : insightItems.length === 0 ? (
              <div className="card text-[var(--ink-muted)]">{t('common.empty')}</div>
            ) : (
              <div className="flex flex-col gap-3">
                {insightItems.slice(0, 6).map((ins) => (
                  <InsightCard key={ins.id} ins={ins} lang={lang} workers={workers.data ?? []} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="sec-h">{t('analytics.ratings')}</h2>
            <div className="card">
              {ratings.isPending ? (
                <SkeletonList rows={2} />
              ) : ratings.isError ? (
                <ErrorState
                  message={toLocalizedError(ratings.error).message}
                  onRetry={() => void ratings.refetch()}
                />
              ) : ratingItems.length === 0 ? (
                <span className="text-[var(--ink-muted)]">{t('common.empty')}</span>
              ) : (
                <>
                  <p className="text-sm text-[var(--ink-muted)] mb-3">
                    {t('analytics.ratingExplanation')}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>{t('analytics.employee')}</th>
                          <th>{t('analytics.score')}</th>
                          <th>{t('metric.closed')}</th>
                          <th>{t('analytics.ratingQuality')}</th>
                          <th>{t('analytics.ratingOnTime')}</th>
                          <th>{t('analytics.ratingRework')}</th>
                          <th>{t('analytics.ratingVolume')}</th>
                          <th>{t('analytics.ratingRejected')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ratingItems.slice(0, 10).map((r) => (
                          <tr key={r.id}>
                            <td data-label={t('analytics.employee')}>
                              {r.name ?? r.id.slice(0, 8)}
                              {r.low_data && (
                                <span className="chip warn ml-2">{t('metric.low_data')}</span>
                              )}
                            </td>
                            <td data-label={t('analytics.score')} className="num font-bold">
                              {r.rating.toFixed(1)}
                            </td>
                            <td data-label={t('metric.closed')} className="num">
                              {r.closed}/{r.total}
                            </td>
                            <td data-label={t('analytics.ratingQuality')} className="num">
                              {Math.round(r.quality * 100)}%
                            </td>
                            <td data-label={t('analytics.ratingOnTime')} className="num">
                              {Math.round(r.on_time * 100)}%
                            </td>
                            <td data-label={t('analytics.ratingRework')} className="num">
                              {Math.round(r.rework_rate * 100)}%
                            </td>
                            <td data-label={t('analytics.ratingVolume')} className="num">
                              {Math.round(r.volume * 100)}%
                            </td>
                            <td data-label={t('analytics.ratingRejected')} className="num">
                              {Math.round(r.rejected * 100)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            <Link to="/manager/areas" className="btn btn-sm mt-2">
              {t('analytics.areasLink')}
            </Link>
          </section>
        </>
      )}

      {tab === 'areas' && <AnalyticsSection path="areas" title={t('analytics.areas')} />}
      {tab === 'equipment' && (
        <AnalyticsSection path="equipment/ranking" title={t('analytics.equipmentRating')} />
      )}
      {tab === 'materials' && (
        <AnalyticsSection path="materials" title={t('analytics.materials')} />
      )}
      {tab === 'downtime' && <AnalyticsSection path="downtime" title={t('analytics.downtime')} />}
      {tab === 'quality' && <QualitySection />}
    </Shell>
  );
}

function QualitySection() {
  const { t } = useTranslation();
  const q = useAnalytics('quality');
  if (q.isPending) return <SkeletonList rows={2} />;
  if (q.isError)
    return (
      <ErrorState message={toLocalizedError(q.error).message} onRetry={() => void q.refetch()} />
    );
  const data = (q.data as { data?: Record<string, number | null> } | undefined)?.data ?? {};
  const rows: [string, number | null, boolean][] = [
    ['metric.reviews', data.reviews ?? null, false],
    ['metric.ai_pass_rate', data.ai_pass_rate ?? null, true],
    ['metric.ai_fail_rate', data.ai_fail_rate ?? null, true],
    ['metric.avg_score', data.avg_score ?? null, false],
    ['metric.rework_rate', data.rework_rate ?? null, true],
    ['metric.orders', data.orders ?? null, false],
  ];
  return (
    <section aria-label={t('analytics.qualityTab')}>
      <h2 className="font-bold text-[17px] mb-2">{t('analytics.qualityTab')}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {rows.map(([key, value, percent]) => (
          <div className="kpi" key={key}>
            <div className="v num">
              {value == null
                ? '—'
                : percent
                  ? `${Math.round(value * 100)}%`
                  : Number(value).toFixed(1)}
            </div>
            <div className="l">{t(key)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
