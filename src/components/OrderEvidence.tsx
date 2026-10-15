import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { photoUrl } from '../api/photos';
import { AIReviewSchema } from '../types/domain';
import { AITag } from './ui';

interface ReviewEvidence {
  verdict?: string;
  score?: number;
  master_score?: number | null;
  explanation?: string | null;
  master_comment?: string | null;
  confidence?: number | null;
  strengths?: string[];
  improvements?: string[];
}

/** Render the actual saved assessment; never invent a score while AI is pending. */
export function OrderAssessment({ review }: { review: unknown }) {
  const { t } = useTranslation();
  if (!review || typeof review !== 'object') return null;
  const parsed = AIReviewSchema.safeParse(review);
  if (!parsed.success) return null;
  const assessment = parsed.data as ReviewEvidence;
  const score = assessment.master_score ?? assessment.score;
  return (
    <section className="card flex flex-col gap-2" aria-label={t('worker.assessment')}>
      <h3 className="font-bold">{t('worker.assessment')}</h3>
      {assessment.verdict && (
        <p>
          {t('worker.aiRecommendation')}:{' '}
          <span>
            {t(
              `ai.verdict_${assessment.verdict === 'needs_master_review' ? 'review' : assessment.verdict}`,
              assessment.verdict,
            )}
          </span>
        </p>
      )}
      {typeof score === 'number' && (
        <p className="label">
          {t(assessment.master_score != null ? 'master.manualScore' : 'worker.aiScore')}
        </p>
      )}
      {typeof score === 'number' && <strong className="num text-2xl">{score} / 100</strong>}
      <AITag confidence={assessment.confidence} explanation={assessment.explanation} />
      {assessment.strengths?.map((text, index) => (
        <p key={`strength-${index}`}>{text}</p>
      ))}
      {assessment.improvements?.map((text, index) => (
        <p key={`improvement-${index}`}>{text}</p>
      ))}
      {assessment.master_comment && (
        <p>
          {t('common.comment')}: {assessment.master_comment}
        </p>
      )}
    </section>
  );
}

export function OrderPhotos({ photos }: { photos: unknown }) {
  const { t } = useTranslation();
  const items = Array.isArray(photos)
    ? (photos as { id: string; kind?: string }[]).filter((photo) => !!photo?.id)
    : [];
  const urls = useQueries({
    queries: items.map((photo) => ({
      queryKey: ['photo-url', photo.id],
      queryFn: () => photoUrl(photo.id),
      staleTime: 60_000,
    })),
  });
  if (!items.length) return null;
  return (
    <section className="card flex flex-col gap-3" aria-label={t('worker.photoEvidence')}>
      <h3 className="font-bold">{t('worker.photoEvidence')}</h3>
      <p className="text-sm text-[var(--ink-muted)]">{t('worker.photoReviewNote')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((photo, index) => (
          <figure key={photo.id} className="min-w-0">
            <figcaption className="label">
              {t(photo.kind === 'before' ? 'master.beforePhoto' : 'worker.afterPhotos')}
            </figcaption>
            {urls[index].isPending ? (
              <p role="status">{t('common.loading')}</p>
            ) : urls[index].isError ? (
              <button className="btn" onClick={() => void urls[index].refetch()}>
                {t('common.retry')}
              </button>
            ) : (
              <a href={urls[index].data} target="_blank" rel="noreferrer">
                <img
                  src={urls[index].data}
                  alt={t(photo.kind === 'before' ? 'master.beforePhoto' : 'worker.afterPhotos')}
                  className="w-full max-h-72 object-contain rounded"
                />
              </a>
            )}
          </figure>
        ))}
      </div>
    </section>
  );
}
