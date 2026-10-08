import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { analyticsGet } from '../api/misc';
import { planOrderFromInsight } from '../api/ai';
import { Shell } from '../components/Shell';
import { AITag, ErrorState, SkeletonList } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';

function useAnalytics(path: string, params: Record<string, string> = {}) {
  return useQuery({ queryKey: ['analytics', path, JSON.stringify(params)], queryFn: () => analyticsGet(path, params) });
}

type Row = Record<string, unknown>;
function asRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data as Row[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    // Бэкенд миксует конверты: {"items": [...]}, {"data": [...]}, {"kpis": {...}}
    if (Array.isArray(o.items)) return o.items as Row[];
    if (Array.isArray(o.data)) return o.data as Row[];
    for (const v of Object.values(o)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v as Row[];
  }
  return [];
}
function fmt(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Generic drill-down table: renders any analytics list defensively. */
function SectionTable({ data, linkPrefix }: { data: unknown; linkPrefix?: string }) {
  const { t } = useTranslation();
  const rows = asRows(data).slice(0, 20);
  if (!rows.length) return <div className="card text-[var(--ink-muted)]">{t('common.empty')}</div>;
  const cols = Object.keys(rows[0] ?? {}).filter((k) => !/id$/i.test(k) || k === 'employee_id').slice(0, 6);
  const idKey = ['id', 'area_id', 'employee_id', 'equipment_id'].find((k) => k in (rows[0] ?? {}));
  return (
    <div className="card overflow-x-auto">
      <table className="tbl">
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r[idKey ?? ''] ?? i)}>
              {cols.map((c) => (
                <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>
                  {linkPrefix && idKey && c === cols[0] && r[idKey] ? (
                    <Link className="text-[var(--brand)]" to={`${linkPrefix}${String(r[idKey])}`}>{fmt(r[c])}</Link>
                  ) : fmt(r[c])}
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
  if (q.isPending) return <section aria-label={path}><h2 className="font-bold text-[17px] mb-2">{title}</h2><SkeletonList rows={2} /></section>;
  if (q.isError) return <section aria-label={path}><h2 className="font-bold text-[17px] mb-2">{title}</h2><ErrorState message={toLocalizedError(q.error).message} onRetry={() => q.refetch()} /></section>;
  return (
    <section aria-label={path}>
      <h2 className="font-bold text-[17px] mb-2">{title}</h2>
      <SectionTable data={q.data} />
    </section>
  );
}

const TABS = [
  { key: 'overview', label: 'Обзор' },
  { key: 'areas', label: 'Участки', path: 'areas' },
  { key: 'equipment', label: 'Оборудование', path: 'equipment/ranking' },
  { key: 'materials', label: 'Материалы', path: 'materials' },
  { key: 'downtime', label: 'Простои', path: 'downtime' },
] as const;

export default function ManagerDashboard() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const loc = useLocation();
  const tab = params.get('tab') ?? (loc.pathname.endsWith('/areas') ? 'areas' : loc.pathname.endsWith('/equipment') ? 'equipment' : 'overview');

  const setTab = (key: string) => setParams(key === 'overview' ? {} : { tab: key });
  const dash = useAnalytics('dashboard');
  const insights = useAnalytics('insights');
  const ratings = useAnalytics('ratings');

  const d = (dash.data ?? {}) as { kpis?: Record<string, number>; total?: number; on_time_pct?: number; trend?: { label: string; value: number }[] };
  const kpis = d.kpis ?? d;
  const insightItems = ((insights.data as { items?: unknown[]; data?: unknown[] })?.items
    ?? (insights.data as { data?: unknown[] })?.data
    ?? (Array.isArray(insights.data) ? insights.data : [])) as { id: string; title?: string; severity?: string; confidence?: number; explanation?: string; recommendation?: string }[];
  const ratingItems = (((ratings.data as { items?: unknown[]; data?: unknown[] })?.items
    ?? (ratings.data as { data?: unknown[] })?.data ?? []) as { employee_id: string; name?: string; score: number }[]);

  return (
    <Shell title={t('nav.analytics')} tabs={[{ to: '/manager', label: t('nav.analytics') }, { to: '/notifications', label: t('nav.notifications') }]}>
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label={t('nav.analytics')}>
        {TABS.map((x) => (
          <button key={x.key} role="tab" aria-selected={tab === x.key} className={`btn btn-sm ${tab === x.key ? 'btn-primary' : ''}`} onClick={() => setTab(x.key)}>{x.label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {dash.isPending ? <SkeletonList rows={2} /> : dash.isError ? <ErrorState message={toLocalizedError(dash.error).message} onRetry={() => dash.refetch()} /> : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {Object.entries(kpis).slice(0, 6).map(([k, v]) => (
                  <div key={k} className="kpi"><div className="v num">{typeof v === 'number' ? v : String(v)}</div><div className="l">{k}</div></div>
                ))}
              </div>
              {d.trend && (
                <div className="card">
                  <h3 className="sec-h">{t('analytics.trend')}</h3>
                  <div style={{ height: 220 }}>
                    <ResponsiveContainer>
                      <BarChart data={d.trend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" fontSize={12} />
                        <YAxis fontSize={12} />
                        <Tooltip />
                        <Bar dataKey="value" fill="var(--chart-1)" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}

          <section>
            <h2 className="sec-h">ИИ-инсайты ({insightItems.length})</h2>
            {insights.isPending ? <SkeletonList rows={2} /> : insightItems.length === 0 ? <div className="card text-[var(--ink-muted)]">{t('common.empty')}</div> : (
              <div className="flex flex-col gap-3">
                {insightItems.slice(0, 6).map((ins) => (
                  <div key={ins.id} className="card flex flex-col gap-2">
                    <div className="flex gap-2 items-center">
                      <span className={`chip ${ins.severity === 'critical' ? 'danger' : 'warn'}`}>{ins.severity ?? 'info'}</span>
                      <b>{ins.title ?? ins.id}</b>
                    </div>
                    <AITag confidence={ins.confidence} explanation={ins.explanation ?? ins.recommendation} />
                    <button className="btn btn-sm btn-ai self-start" onClick={() => planOrderFromInsight(ins.id, { due_at: new Date(Date.now() + 86400000).toISOString() }, crypto.randomUUID()).catch(() => {})}>
                      {t('ai.apply')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="sec-h">{t('analytics.ratings')}</h2>
            <div className="card">
              {ratingItems.length === 0 ? <span className="text-[var(--ink-muted)]">{t('common.empty')}</span> : (
                <table className="tbl">
                  <thead><tr><th>{t('analytics.employee')}</th><th>{t('analytics.score')}</th></tr></thead>
                  <tbody>
                    {ratingItems.slice(0, 10).map((r) => (
                      <tr key={r.employee_id}><td>{r.name ?? r.employee_id}</td><td className="num font-bold">{r.score}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <Link to="/manager/areas" className="btn btn-sm mt-2">{t('analytics.areasLink')}</Link>
          </section>
        </>
      )}

      {tab === 'areas' && <AnalyticsSection path="areas" title="Участки" />}
      {tab === 'equipment' && <AnalyticsSection path="equipment/ranking" title="Рейтинг оборудования" />}
      {tab === 'materials' && <AnalyticsSection path="materials" title="Материалы" />}
      {tab === 'downtime' && <AnalyticsSection path="downtime" title="Простои" />}
    </Shell>
  );
}
