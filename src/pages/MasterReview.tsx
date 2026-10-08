import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkOrder, reviewDecision, transitionOrder } from '../api/workOrders';
import { getInspection } from '../api/ai';
import { Shell } from '../components/Shell';
import { displayOrder, useNames } from '../hooks/useNames';
import { AITag, EmptyState, ErrorState, PriorityTag, SkeletonList, StatusChip } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';

export default function MasterReview() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const names = useNames();
  const [comment, setComment] = useState('');

  const order = useQuery({ queryKey: ['order', id], queryFn: () => getWorkOrder(id) });
  const review = useQuery({ queryKey: ['order', id, 'ai-review'], queryFn: () => getInspection(id), retry: 1 });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const decide = useMutation({
    mutationFn: (vars: { decision: 'agree_ai' | 'override'; score?: number }) =>
      reviewDecision(id, vars.decision, vars.score, comment || undefined, crypto.randomUUID()),
    onSuccess: invalidate,
  });

  const rework = useMutation({
    mutationFn: () => transitionOrder(id, 'return_to_rework', { comment }, crypto.randomUUID()),
    onSuccess: invalidate,
  });

  if (order.isPending) return <Shell title="…" tabs={[{ to: '/master', label: t('master.shift') }]}><SkeletonList /></Shell>;
  if (order.isError) return <Shell title="!" tabs={[{ to: '/master', label: t('master.shift') }]}><ErrorState message={toLocalizedError(order.error).message} /></Shell>;
  const o = displayOrder(order.data, names);

  const verdict = (review.data?.verdict ?? '') as string;
  const needsRework = verdict === 'needs_rework';

  return (
    <Shell title={`${t('master.review')} №${String(o.number ?? '')}`} tabs={[{ to: '/master/board', label: t('nav.board') }]}>
      <div className="card flex flex-col gap-2">
        <div className="flex justify-between"><PriorityTag priority={o.priority} /><StatusChip status={o.status} overdue={o.is_overdue} /></div>
        <p className="text-[16px]">{o.description}</p>
        <div className="text-sm text-[var(--ink-muted)]">{[o.equipment_name, o.area_name, o.assignee_name].filter(Boolean).join(' · ')}</div>
      </div>

      {review.isPending ? <SkeletonList rows={2} /> :
        review.isError ? <div className="banner banner-warn">{t('master.reviewPending')}</div> :
        (
          <div className={needsRework ? 'card crit' : 'card'}>
            <div className="ai-tag">✦ {t('ai.tag')}</div>
            <div className="flex gap-2 items-center mt-1">
              <span className={`chip ${needsRework ? 'danger' : verdict.includes('accept') ? 'ok' : 'ai'}`}>
                {needsRework ? t('ai.verdict_needs_rework') : verdict.includes('accept') ? t('ai.verdict_accepted') : t('ai.verdict_review')}
              </span>
              {typeof review.data.score === 'number' && <span className="num font-bold">{review.data.score}</span>}
            </div>
            <AITag confidence={review.data.confidence} explanation={review.data.explanation} />
            {review.data.checks != null && <pre className="mono text-xs mt-2 overflow-auto">{JSON.stringify(review.data.checks, null, 2)}</pre>}
          </div>
        )}

      <div className="card flex flex-col gap-2">
        <label className="flex flex-col gap-1"><span className="label">{t('common.comment')}</span>
          <textarea className="input area" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('master.reworkNeedsComment')} />
        </label>
        <div className="dock !p-0 !bg-transparent !border-0">
          <button className="btn btn-ok btn-xl btn-block" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'agree_ai' })}>
            {t('master.agreeClose')}
          </button>
          <button className="btn btn-danger btn-block" disabled={!comment.trim() || rework.isPending} onClick={() => rework.mutate()}>
            {t('master.sendRework')}
          </button>
        </div>
        {(decide.isError || rework.isError) && <ErrorState message={toLocalizedError((decide.error ?? rework.error) as unknown).message} />}
        {(o.allowed_actions ?? []).length === 0 && <EmptyState text={t('common.empty')} />}
      </div>
    </Shell>
  );
}
