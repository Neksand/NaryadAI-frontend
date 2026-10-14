import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { analyticsGet } from '../api/misc';
import { Shell, roleTabs } from '../components/Shell';
import { ErrorState, SkeletonList } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';
import { useAuthStore } from '../store/auth-store';

interface Rating {
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
}

export default function WorkerProfile() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const ratingQuery = useQuery({
    queryKey: ['analytics', 'ratings', 'me'],
    queryFn: () => analyticsGet('ratings/me'),
    networkMode: 'always',
  });
  const rating = (ratingQuery.data as { data?: Rating | null } | undefined)?.data ?? null;

  const content = ratingQuery.isPending ? (
    <SkeletonList rows={2} />
  ) : ratingQuery.isError ? (
    <ErrorState
      message={toLocalizedError(ratingQuery.error).message}
      onRetry={() => void ratingQuery.refetch()}
    />
  ) : !rating ? (
    <div className="card text-[var(--ink-muted)]" role="status">
      {t('analytics.noRating')}
    </div>
  ) : (
    <>
      <section className="card flex flex-col gap-3" aria-label={t('analytics.profileRating')}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold">
              {user?.full_name ?? rating.name ?? t('nav.profile')}
            </h2>
            <p className="text-sm text-[var(--ink-muted)]">
              {t('analytics.ratings')} · {t('metric.closed')}: {rating.closed}/{rating.total}
            </p>
          </div>
          <div className="text-right">
            <strong className="text-4xl num">{rating.rating.toFixed(1)}</strong>
            <span className="text-[var(--ink-muted)]"> / 100</span>
          </div>
        </div>
        {rating.low_data && (
          <div className="banner banner-warn" role="note">
            {t('analytics.ratingSample')}
          </div>
        )}
        <p className="text-sm text-[var(--ink-muted)]">{t('analytics.ratingExplanation')}</p>
      </section>
      <section className="card flex flex-col gap-3" aria-label={t('analytics.ratingExplanation')}>
        {[
          ['analytics.ratingQuality', rating.quality, 35],
          ['analytics.ratingOnTime', rating.on_time, 25],
          ['analytics.ratingRework', 1 - rating.rework_rate, 20],
          ['analytics.ratingVolume', rating.volume, 15],
          ['analytics.ratingRejected', 1 - rating.rejected, 5],
        ].map(([label, value, weight]) => {
          const share = Number(value);
          const max = Number(weight);
          return (
            <div key={String(label)} className="flex items-center gap-3">
              <span className="flex-1">{t(String(label))}</span>
              <span className="mono text-[var(--ink-muted)]">{Math.round(share * 100)}%</span>
              <span className="mono font-semibold w-20 text-right">
                {(share * max).toFixed(1)} / {max}
              </span>
            </div>
          );
        })}
      </section>
    </>
  );

  return (
    <Shell title={t('nav.profile')} tabs={roleTabs(t, 'worker')}>
      {content}
    </Shell>
  );
}
