import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, toLocalizedError } from '../lib/api-client';
import { EmptyState, ErrorState, SkeletonList } from './ui';

export interface ForecastItem {
  equipment_id: string;
  equipment_name: string;
  probability: number;
  recent: number;
  growth: number;
}

/** Топ-N оборудования с наивысшей вероятностью отказа (бэкенд уже сортирует по убыванию). */
export async function fetchFailureForecast(limit = 5): Promise<ForecastItem[]> {
  const { data } = await api.get('/analytics/failure-forecast');
  const raw = Array.isArray(data) ? data : (data?.items ?? data?.data ?? []);
  return (Array.isArray(raw) ? raw : []).slice(0, limit) as ForecastItem[];
}

export function ForecastPanel({ limit = 5 }: { limit?: number }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['analytics', 'failure-forecast', String(limit)],
    queryFn: () => fetchFailureForecast(limit),
  });

  return (
    <section className="card flex flex-col gap-3" aria-label={t('analytics.forecast')}>
      <h2 className="font-bold text-[17px]">{t('analytics.forecast')}</h2>
      {query.isPending ? (
        <SkeletonList rows={2} />
      ) : query.isError ? (
        <ErrorState
          message={toLocalizedError(query.error).message}
          onRetry={() => void query.refetch()}
        />
      ) : !query.data.length ? (
        <EmptyState text={t('common.empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {query.data.map((item) => (
            <li
              key={item.equipment_id}
              className="flex items-center justify-between gap-2 flex-wrap"
            >
              <div className="flex flex-col">
                <span className="font-semibold">{item.equipment_name}</span>
                <span className="text-sm text-[var(--ink-muted)]">
                  {t('analytics.forecastRecent')}: {item.recent} · {t('analytics.forecastGrowth')}:{' '}
                  {Math.round(item.growth * 100)}%
                </span>
              </div>
              <span
                className="num font-bold"
                aria-label={`${t('analytics.forecastProbability')}: ${Math.round(item.probability * 100)}%`}
              >
                {Math.round(item.probability * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
