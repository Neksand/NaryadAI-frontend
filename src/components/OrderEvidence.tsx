import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { photoUrl } from '../api/photos';
import { AIReviewSchema } from '../types/domain';
import { AITag } from './ui';
import { Lightbox, type LightboxItem } from './Lightbox';

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
  const [openIndex, setOpenIndex] = useState<number | null>(null);
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
  const loaded: LightboxItem[] = items.flatMap((photo, index) => {
    const url = urls[index]?.data;
    if (typeof url !== 'string' || !url) return [];
    return [
      {
        src: url,
        alt: t(photo.kind === 'before' ? 'master.beforePhoto' : 'worker.afterPhotos'),
      },
    ];
  });
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
              <button
                type="button"
                className="block w-full !p-0 !border-0 !bg-transparent"
                onClick={() => {
                  const at = loaded.findIndex(
                    (l) =>
                      l.src === urls[index].data &&
                      l.alt ===
                        t(photo.kind === 'before' ? 'master.beforePhoto' : 'worker.afterPhotos'),
                  );
                  setOpenIndex(at >= 0 ? at : 0);
                }}
                aria-label={t('lightbox.open', 'Открыть фото')}
              >
                <img
                  src={urls[index].data}
                  alt={t(photo.kind === 'before' ? 'master.beforePhoto' : 'worker.afterPhotos')}
                  className="w-full max-h-72 object-contain rounded"
                />
              </button>
            )}
          </figure>
        ))}
      </div>
      {openIndex !== null && loaded.length > 0 && (
        <Lightbox
          items={loaded}
          index={Math.min(openIndex, loaded.length - 1)}
          onClose={() => setOpenIndex(null)}
          onIndex={setOpenIndex}
        />
      )}
    </section>
  );
}

/** Drill-down от инсайта к доказательствам: count/denominator/formula + исходные наряды. */
export interface InsightLike {
  id: string;
  order_ids?: unknown;
  orderIds?: unknown;
  denominator?: unknown;
  formula?: unknown;
  count?: unknown;
  evidence?: unknown;
}

export interface InsightDrilldown {
  count: number | null;
  denominator: number | null;
  formula: string;
  orderIds: string[];
  metric?: string;
}

export const INSIGHT_FORMULAS: Record<string, string> = {
  repeat_count: 'n / total ≥ 0.5, n ≥ 4',
  post_ppr_case: 'unplanned within 14d after planned close (same equipment)',
  overuse_ratio: 'qty / typical > 2',
  shift_share: 'n_shift / total ≥ 0.6, n ≥ 6',
  growth: 'cur ≥ 2 × prev, cur ≥ 4',
  downtime_hours: 'sum(stop → restore) TOP-3, ≥ 4h',
  duration_z: 'z = (cur − base) / sd ≥ 2',
};

function asEvidenceArray(evidence: unknown): Record<string, unknown>[] {
  let raw = evidence;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter((s) => s.length > 0);
}

/** Разбирает ответ аналитики: top-level order_ids/denominator/formula либо evidence[]. */
export function parseInsightDrilldown(insight: InsightLike): InsightDrilldown {
  const obj = (insight ?? {}) as unknown as Record<string, unknown>;
  const evidence = asEvidenceArray(obj.evidence);
  const first = evidence[0] ?? {};

  const orderIds: string[] = [];
  for (const v of asStringList(obj.order_ids).concat(asStringList(obj.orderIds))) {
    if (!orderIds.includes(v)) orderIds.push(v);
  }
  for (const item of evidence) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const singles = [rec.order_id, rec.work_order_id].filter(
      (v): v is string | number => typeof v === 'string' || typeof v === 'number',
    );
    for (const s of singles.map(String).filter(Boolean)) {
      if (!orderIds.includes(s)) orderIds.push(s);
    }
    for (const s of asStringList(rec.order_ids)) {
      if (!orderIds.includes(s)) orderIds.push(s);
    }
  }

  const metric = typeof first.metric === 'string' ? first.metric : undefined;
  let count: number | null = null;
  if (typeof obj.count === 'number' && Number.isFinite(obj.count)) count = obj.count;
  else if (typeof first.value === 'number' && Number.isFinite(first.value)) count = first.value;
  else if (orderIds.length > 0) count = orderIds.length;

  let denominator: number | null = null;
  if (typeof obj.denominator === 'number' && Number.isFinite(obj.denominator)) {
    denominator = obj.denominator;
  } else if (typeof first.baseline === 'number' && Number.isFinite(first.baseline)) {
    denominator = first.baseline;
  } else if (typeof first.total === 'number' && Number.isFinite(first.total)) {
    denominator = first.total;
  } else if (typeof first.denominator === 'number' && Number.isFinite(first.denominator)) {
    denominator = first.denominator;
  }

  let formula = '—';
  if (typeof obj.formula === 'string' && obj.formula.length > 0) formula = obj.formula;
  else if (metric && INSIGHT_FORMULAS[metric]) formula = INSIGHT_FORMULAS[metric];

  return { count, denominator, formula, orderIds, metric };
}

/** Раскрытие инсайта: счётчики, формула моноширинно, ссылки на наряды, пометка о непричинности. */
export function InsightEvidence({ insight }: { insight: InsightLike }) {
  const { t } = useTranslation();
  const drill = parseInsightDrilldown(insight);
  return (
    <div className="flex flex-col gap-2" aria-label={t('analytics.evidence')}>
      <p className="text-sm">
        {t('analytics.insightCount')}: <strong className="num">{drill.count ?? '—'}</strong> ·{' '}
        {t('analytics.insightDenominator')}:{' '}
        <strong className="num">{drill.denominator ?? '—'}</strong>
      </p>
      <p className="text-sm">
        {t('analytics.insightFormula')}: <code className="font-mono">{drill.formula}</code>
      </p>
      {drill.orderIds.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="label">{t('analytics.insightOrders')}</p>
          <ul className="flex flex-col gap-1">
            {drill.orderIds.map((id) => (
              <li key={id}>
                <Link className="text-[var(--brand)]" to={`/master/orders/${id}`}>
                  {id.slice(0, 8)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-[var(--ink-muted)]">{t('analytics.insightNoOrders')}</p>
      )}
      <p className="text-sm text-[var(--ink-muted)]">{t('analytics.insightNoCause')}</p>
    </div>
  );
}
