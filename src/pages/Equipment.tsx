import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { catalogList } from '../api/misc';
import { getEquipmentHistory } from '../api/workOrders';
import type { EquipmentHistoryItem } from '../api/workOrders';
import { api, toLocalizedError } from '../lib/api-client';
import { Shell, roleTabs } from '../components/Shell';
import { ErrorState, SkeletonList } from '../components/ui';
import { useAuthStore } from '../store/auth-store';
import { pickName } from '../lib/names';

interface EquipmentRow {
  id: string;
  name?: string;
  name_kk?: string;
  inventory_no?: string;
  area_id?: string | null;
  area_name?: string | null;
  area_name_kk?: string | null;
  type?: string | null;
  criticality?: string | null;
  qr_token?: string | null;
}

interface SiteRow {
  id: string;
  name?: string;
  name_kk?: string;
}

/** GET /equipment/by-qr/:token — контракт сида: qr_token вида NAR-00001. */
async function getEquipmentByQr(token: string): Promise<EquipmentRow> {
  const { data } = await api.get(`/equipment/by-qr/${encodeURIComponent(token.trim())}`);
  return data as EquipmentRow;
}

/**
 * Карточка оборудования: :id из URL, поиск по QR-токену, история ремонтов.
 * Доступ: master/manager/admin; worker — редирект на /worker.
 * Роут подводит координатор (ожидается /equipment/:id), App.tsx не трогаем.
 */
export function EquipmentPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'ru').slice(0, 2);
  const role = useAuthStore((s) => s.role);
  const navigate = useNavigate();
  const location = useLocation();
  const [qrInput, setQrInput] = useState('');
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrResult, setQrResult] = useState<EquipmentRow | null>(null);

  const equipmentList = useQuery({
    queryKey: ['catalog', 'equipment', 'all'],
    queryFn: () => catalogList('equipment'),
    staleTime: 60000,
  });
  const sites = useQuery({
    queryKey: ['catalog', 'sites'],
    queryFn: () => catalogList('sites'),
    staleTime: 60000,
  });

  const foundById = id
    ? ((equipmentList.data ?? []) as EquipmentRow[]).find((e) => e.id === id)
    : undefined;
  // QR-находка — запасной показ, если списка ещё нет или id в нём отсутствует.
  const shown = foundById ?? (qrResult && (!id || qrResult.id === id) ? qrResult : null) ?? null;
  const shownId = shown?.id ?? '';

  const history = useQuery({
    queryKey: ['equipment-history', shownId],
    queryFn: () => getEquipmentHistory(shownId),
    enabled: Boolean(shownId),
  });

  const goToEquipment = (equipmentId: string) => {
    const p = location.pathname;
    const i = p.lastIndexOf('/equipment/');
    if (i >= 0) navigate(`${p.slice(0, i + '/equipment'.length)}/${equipmentId}`);
    else navigate(`/equipment/${equipmentId}`);
  };

  const runQrSearch = async () => {
    const token = qrInput.trim();
    if (!token || qrBusy) return;
    setQrBusy(true);
    setQrError(null);
    try {
      const eq = await getEquipmentByQr(token);
      setQrResult(eq);
      if (eq?.id) goToEquipment(eq.id);
    } catch (e) {
      setQrResult(null);
      setQrError(toLocalizedError(e).message);
    } finally {
      setQrBusy(false);
    }
  };

  const areaName = (() => {
    if (!shown) return '—';
    if (lang === 'kk' && shown.area_name_kk?.trim()) return shown.area_name_kk;
    if (shown.area_name?.trim()) return shown.area_name;
    const area = ((sites.data ?? []) as SiteRow[]).find((a) => a.id === shown.area_id);
    return (area && (pickName(area, lang) || area.name)) || shown.area_id || '—';
  })();
  const displayName = shown ? pickName(shown, lang) || shown.name || shown.id : '';

  if (role === 'worker') return <Navigate to="/worker" replace />;

  return (
    <Shell title={displayName || t('dictType.equipment')} tabs={roleTabs(t, role ?? 'master')}>
      {equipmentList.isPending ? (
        <SkeletonList rows={1} />
      ) : equipmentList.isError ? (
        <ErrorState
          message={toLocalizedError(equipmentList.error).message}
          onRetry={() => void equipmentList.refetch()}
        />
      ) : id && !shown ? (
        <div className="card text-[var(--ink-muted)]" role="status">
          {t('error.notFound')}
        </div>
      ) : shown ? (
        <dl className="card flex flex-col gap-2" aria-label={displayName}>
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--ink-muted)]">{t('common.name')}</dt>
            <dd className="font-semibold text-right">{displayName}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--ink-muted)]">{t('admin.fInvNo')}</dt>
            <dd className="mono font-semibold text-right">{shown.inventory_no || '—'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--ink-muted)]">{t('admin.fArea')}</dt>
            <dd className="text-right">{areaName}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--ink-muted)]">{t('admin.fEqType')}</dt>
            <dd className="text-right">{shown.type || '—'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--ink-muted)]">{t('admin.fCrit')}</dt>
            <dd className="text-right">{shown.criticality || '—'}</dd>
          </div>
        </dl>
      ) : null}

      <form
        className="card flex flex-col gap-2"
        aria-label="Поиск оборудования по коду"
        onSubmit={(e) => {
          e.preventDefault();
          void runQrSearch();
        }}
      >
        <label className="flex flex-col gap-1" htmlFor="equipment-qr">
          <span className="label">QR-токен</span>
        </label>
        <div className="flex gap-2">
          <input
            id="equipment-qr"
            className="input mono"
            value={qrInput}
            onChange={(e) => setQrInput(e.target.value)}
            placeholder="NAR-00001"
            aria-label="QR-токен"
            autoComplete="off"
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={qrBusy || !qrInput.trim()}
            onClick={() => void runQrSearch()}
          >
            {qrBusy ? t('common.loading') : 'Найти'}
          </button>
        </div>
        {qrError && (
          <div className="banner banner-danger" role="alert">
            {qrError}
          </div>
        )}
      </form>

      {shownId && (
        <section aria-label={t('master.repairHistory')}>
          <h2 className="font-bold text-[17px] mb-2">{t('master.repairHistory')}</h2>
          {history.isPending ? (
            <SkeletonList rows={1} />
          ) : history.isError ? (
            <ErrorState
              message={toLocalizedError(history.error).message}
              onRetry={() => void history.refetch()}
            />
          ) : (
            <RepairHistory items={history.data ?? []} lang={lang} />
          )}
        </section>
      )}
    </Shell>
  );
}

export default EquipmentPage;

// Локальная копия RepairHistory из MasterOrder.tsx (требование: скопировать
// минимально, в shared не выносить). Упрощена: нет текущего наряда — баннер
// повторов не считаем; строки, пустое состояние и ссылки — та же логика.
function RepairHistory({ items, lang }: { items: EquipmentHistoryItem[]; lang: string }) {
  const { t } = useTranslation();
  if (!items.length)
    return (
      <div className="card text-[var(--ink-muted)]" role="status">
        {t('master.noRepairHistory')}
      </div>
    );

  const rows = items.slice(0, 5);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((item) => {
        const date =
          item.issued_at && !Number.isNaN(Date.parse(item.issued_at))
            ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(
                new Date(item.issued_at),
              )
            : '—';
        const status = item.status ? t(`status.${item.status}`, item.status) : '—';
        const fault =
          lang === 'kk'
            ? item.fault_name_kk || item.fault_name || item.fault_code
            : item.fault_name || item.fault_code;
        return (
          <article key={item.id} className="card flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <Link className="font-semibold text-[var(--brand)]" to={`/master/orders/${item.id}`}>
                {t('master.historyOrder', { number: item.number ?? item.id.slice(0, 8) })}
              </Link>
              <span className="chip">{status}</span>
            </div>
            <div className="text-sm text-[var(--ink-muted)]">
              {date}
              {fault ? ` · ${fault}` : ''}
            </div>
            {item.description && <p className="text-sm">{item.description}</p>}
            {item.work_done_text && (
              <p className="text-sm text-[var(--ink-muted)]">
                {t('master.repairOutcome')}: {item.work_done_text}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
