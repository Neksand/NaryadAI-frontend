import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkOrder, transitionOrder } from '../api/workOrders';
import { Shell } from '../components/Shell';
import { displayOrder, useNames } from '../hooks/useNames';
import { EmptyState, ErrorState, PriorityTag, SkeletonList, StatusChip } from '../components/ui';
import { toLocalizedError } from '../lib/api-client';

/** Master order view: renders backend allowed_actions (close/reassign/cancel/change_priority/…). */
export default function MasterOrder() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const names = useNames();
  const [assignee, setAssignee] = useState('');

  const order = useQuery({ queryKey: ['order', id], queryFn: () => getWorkOrder(id) });
  const act = useMutation({
    mutationFn: (vars: { action: string; body?: Record<string, unknown> }) =>
      transitionOrder(id, vars.action, vars.body ?? {}, crypto.randomUUID()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['order', id] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  if (order.isPending) return <Shell title="…" tabs={[{ to: '/master/board', label: t('nav.board') }]}><SkeletonList /></Shell>;
  if (order.isError) return <Shell title="!" tabs={[{ to: '/master/board', label: t('nav.board') }]}><ErrorState message={toLocalizedError(order.error).message} /></Shell>;
  const o = displayOrder(order.data, names);

  return (
    <Shell title={`№${o.number ?? o.id.slice(0, 8)}`} tabs={[{ to: '/master/board', label: t('nav.board') }]}>
      <div className="card flex flex-col gap-2">
        <div className="flex justify-between"><PriorityTag priority={o.priority} /><StatusChip status={o.status} overdue={o.is_overdue} /></div>
        <p className="text-[16px]">{o.description}</p>
        <div className="text-sm text-[var(--ink-muted)]">{[o.equipment_name, o.area_name, o.assignee_name].filter(Boolean).join(' · ')}</div>
        <div className="mono text-[var(--ink-muted)] text-xs">{t('common.actions')}: {(o.allowed_actions ?? []).join(', ') || '—'}</div>
      </div>

      <div className="flex flex-col gap-2">
        {(o.allowed_actions ?? []).map((a) => {
          if (a === 'close') return <Link key={a} className="btn btn-ok btn-block" to={`/master/review/${o.id}`}>{t('action.close')} →</Link>;
          if (a === 'return_to_rework') return <Link key={a} className="btn btn-danger btn-block" to={`/master/review/${o.id}`}>{t('action.rework')} →</Link>;
          if (a === 'reassign') return (
            <div key={a} className="card flex gap-2">
              <input className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="ID исполнителя" aria-label={t('master.assignee')} />
              <button className="btn btn-primary" disabled={!assignee || act.isPending} onClick={() => act.mutate({ action: 'reassign', body: { assignee_id: assignee } })}>{t('action.reassign')}</button>
            </div>
          );
          return <button key={a} className="btn btn-block" disabled={act.isPending} onClick={() => act.mutate({ action: a })}>{t(`action.${a}`, a)}</button>;
        })}
        {(o.allowed_actions ?? []).length === 0 && <EmptyState text={t('common.empty')} />}
      </div>
      {act.isError && <ErrorState message={toLocalizedError(act.error).message} />}
    </Shell>
  );
}
