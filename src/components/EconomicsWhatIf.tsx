import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { analyticsGet } from '../api/misc';
import { toLocalizedError } from '../lib/api-client';
import { useAuthStore } from '../store/auth-store';
import { ErrorState, SkeletonList } from './ui';
import {
  PriceTable,
  calcMaterialsCost,
  parseMaterialRows,
  useMaterialPrices,
  validPricesOf,
} from './PriceTable';

/**
 * Базовый сценарий экономики.
 * null означает «бэкенд значение не отдал» — такие цены НЕ подменяем
 * дефолтами, результат расчёта остаётся unknown.
 */
export interface EconomicsBase {
  /** Суммарные часы простоя за месяц (из аналитики простоев). */
  monthlyDowntimeHours: number | null;
  /** Цена часа простоя (бэкенд её не отдаёт — обычно null). */
  downtimeCostPerHour: number | null;
  /** Затраты на материалы за месяц (из аналитики материалов). */
  monthlyMaterialsCost: number | null;
}

export interface WhatIfInputs {
  pricePerHour: number;
  materialsNormPct: number;
  horizonMonths: number;
}

export interface WhatIfResult {
  monthlyBenefit: number | null;
  materialsDelta: number | null;
  monthlyNet: number | null;
  npv: number | null;
  roi: number | null;
}

/** Доля простоев, которую предотвращаем, — гипотеза, показана в допущениях. */
export const WHATIF_PREVENTION_SHARE = 0.2;
/** Месячная ставка дисконтирования (12% годовых / 12). */
export const WHATIF_MONTHLY_RATE = 0.01;
/** Стартовая цена слайдера, когда бэкенд цену не отдал (помечается как допущение). */
export const WHATIF_DEFAULT_PRICE = 50000;

function toNum(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = toNum(obj[k]);
    if (n != null) return n;
  }
  return null;
}

function rowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items as Record<string, unknown>[];
    if (Array.isArray(o.data)) return o.data as Record<string, unknown>[];
  }
  return [];
}

/** Суммирует первый найденный числовой показатель по строкам; 0 строк с числами → null. */
function sumRows(data: unknown, keys: string[]): number | null {
  let sum = 0;
  let found = false;
  for (const r of rowsOf(data)) {
    if (!r || typeof r !== 'object') continue;
    const n = pickNum(r, keys);
    if (n != null) {
      sum += n;
      found = true;
    }
  }
  return found ? sum : null;
}

function singleOf(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object' && !Array.isArray(data))
    return data as Record<string, unknown>;
  return null;
}

/**
 * Собирает базовый сценарий из существующих эндпоинтов аналитики
 * (те же, что рисуют вкладки «Простои» и «Материалы» дашборда).
 * Ничего не выдумывает: не нашлось числа — поле null → итоги unknown.
 */
export function parseEconomicsBase(downtime: unknown, materials: unknown): EconomicsBase {
  const d = singleOf(downtime);
  const m = singleOf(materials);
  const monthlyDowntimeHours =
    (d ? pickNum(d, ['downtime_hours', 'total_hours', 'hours', 'duration_hours']) : null) ??
    sumRows(downtime, ['downtime_hours', 'total_hours', 'hours', 'duration_hours']);
  const monthlyMaterialsCost =
    (m ? pickNum(m, ['monthly_cost', 'total_cost', 'cost', 'sum', 'amount']) : null) ??
    sumRows(materials, ['total_cost', 'cost', 'sum', 'amount', 'total']);
  return { monthlyDowntimeHours, downtimeCostPerHour: null, monthlyMaterialsCost };
}

/** Один запрос на всё: переиспользует готовый analyticsGet, нового API нет. */
export async function fetchEconomicsBase(): Promise<EconomicsBase> {
  const [downtime, materials] = await Promise.all([
    analyticsGet('downtime'),
    analyticsGet('materials'),
  ]);
  return parseEconomicsBase(downtime, materials);
}

/**
 * Чисто клиентский пересчёт. Любой неизвестный вход (null) даёт
 * unknown-выходы — отсутствующие цены числом не становятся.
 */
export function calcWhatIf(base: EconomicsBase, inputs: WhatIfInputs): WhatIfResult {
  const empty: WhatIfResult = {
    monthlyBenefit: null,
    materialsDelta: null,
    monthlyNet: null,
    npv: null,
    roi: null,
  };
  if (base.monthlyDowntimeHours == null || base.monthlyMaterialsCost == null) return empty;
  const monthlyBenefit = base.monthlyDowntimeHours * inputs.pricePerHour * WHATIF_PREVENTION_SHARE;
  const materialsDelta = (base.monthlyMaterialsCost * inputs.materialsNormPct) / 100;
  const monthlyNet = monthlyBenefit - materialsDelta;
  let npv = 0;
  for (let m = 1; m <= inputs.horizonMonths; m++)
    npv += monthlyNet / Math.pow(1 + WHATIF_MONTHLY_RATE, m);
  const baselineSpend = base.monthlyMaterialsCost * inputs.horizonMonths;
  // ROI считаем к базовым затратам на материалы за горизонт (капвложений
  // бэкенд не отдаёт — см. допущения). Нулевая база → unknown, а не Infinity.
  const roi = baselineSpend > 0 ? npv / baselineSpend : null;
  return { monthlyBenefit, materialsDelta, monthlyNet, npv, roi };
}

function fmtMoney(v: number): string {
  return `${Math.round(v).toLocaleString('ru-RU')} ₸`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function EconomicsWhatIf({
  base: baseProp,
  materials: materialsProp,
  userId: userIdProp,
}: {
  base?: EconomicsBase;
  /** Сырой ответ analyticsGet('materials') — в тестах/шовe витрины; иначе грузим сами. */
  materials?: unknown;
  /** Переопределение пользователя для изоляции цен (по умолчанию — из auth-store). */
  userId?: string;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['analytics', 'economics-whatif'],
    queryFn: fetchEconomicsBase,
    enabled: baseProp === undefined,
    staleTime: 60000,
  });
  const materialsQuery = useQuery({
    queryKey: ['analytics', 'materials'],
    queryFn: () => analyticsGet('materials'),
    enabled: baseProp === undefined && materialsProp === undefined,
    staleTime: 60000,
  });
  const base = baseProp ?? query.data ?? null;
  const materialsData = materialsProp ?? materialsQuery.data ?? null;
  const authUserId = useAuthStore((s) => s.user?.id ?? 'anonymous');
  const userId = userIdProp ?? authUserId;

  // Цена — всегда гипотеза пользователя (слайдер). Если бэкенд цену не отдал,
  // это честно помечается в допущениях, а не выдаётся за данные.
  const [price, setPrice] = useState<number | null>(null);
  const [normPct, setNormPct] = useState(0);
  const [horizon, setHorizon] = useState(12);

  // Витрина «ваши цены»: справочник материалов цен не отдаёт, поэтому мастер
  // вводит цену за единицу сам; monthlyMaterialsCost = Σ(qty × цена).
  const materialRows = useMemo(() => parseMaterialRows(materialsData), [materialsData]);
  const { drafts, setDraft, reset } = useMaterialPrices(userId);
  const userCost = useMemo(
    () => calcMaterialsCost(materialRows, validPricesOf(drafts)),
    [materialRows, drafts],
  );
  const usingUserPrices = userCost.total != null;

  if (baseProp === undefined && (query.isPending || materialsQuery.isPending))
    return <SkeletonList rows={2} />;
  if (baseProp === undefined && query.isError)
    return (
      <ErrorState
        message={toLocalizedError(query.error).message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!base) return null;

  const effectivePrice = price ?? base.downtimeCostPerHour ?? WHATIF_DEFAULT_PRICE;
  const priceAssumed = base.downtimeCostPerHour == null;
  // Введённые цены перекрывают бэкенд-оценку затрат на материалы; без них — как было.
  const effectiveBase: EconomicsBase = usingUserPrices
    ? { ...base, monthlyMaterialsCost: userCost.total }
    : base;
  const result = calcWhatIf(effectiveBase, {
    pricePerHour: effectivePrice,
    materialsNormPct: normPct,
    horizonMonths: horizon,
  });
  const unknown = t('economics.whatifUnknown');
  const yourPrices = usingUserPrices ? (
    <span className="text-xs font-normal text-[var(--ink-muted)]" data-testid="whatif-your-prices">
      {' '}
      · {t('economics.whatifPriceBadge')}
    </span>
  ) : null;

  return (
    <section className="card flex flex-col gap-3" aria-label={t('economics.whatifTitle')}>
      <div>
        <h2 className="font-bold text-[17px]">{t('economics.whatifTitle')}</h2>
        <p className="text-sm text-[var(--ink-muted)]">{t('economics.whatifDesc')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('economics.whatifPrice')}: <b className="num">{fmtMoney(effectivePrice)}</b>
          <input
            type="range"
            min={0}
            max={200000}
            step={5000}
            value={effectivePrice}
            data-testid="whatif-price"
            aria-label={t('economics.whatifPrice')}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('economics.whatifNorm')}:{' '}
          <b className="num">{normPct > 0 ? `+${normPct}%` : `${normPct}%`}</b>
          <input
            type="range"
            min={-50}
            max={50}
            step={5}
            value={normPct}
            data-testid="whatif-norm"
            aria-label={t('economics.whatifNorm')}
            onChange={(e) => setNormPct(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('economics.whatifHorizon')}: <b className="num">{horizon}</b>
          <input
            type="range"
            min={1}
            max={36}
            step={1}
            value={horizon}
            data-testid="whatif-horizon"
            aria-label={t('economics.whatifHorizon')}
            onChange={(e) => setHorizon(Number(e.target.value))}
          />
        </label>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi">
          <dt className="l">
            {t('economics.whatifBenefit')}
            {yourPrices}
          </dt>
          <dd className="v num" data-testid="whatif-benefit">
            {result.monthlyBenefit == null ? unknown : fmtMoney(result.monthlyBenefit)}
          </dd>
        </div>
        <div className="kpi">
          <dt className="l">
            {t('economics.whatifNet')}
            {yourPrices}
          </dt>
          <dd className="v num" data-testid="whatif-net">
            {result.monthlyNet == null ? unknown : fmtMoney(result.monthlyNet)}
          </dd>
        </div>
        <div className="kpi">
          <dt className="l">
            {t('economics.whatifNpv')}
            {yourPrices}
          </dt>
          <dd className="v num" data-testid="whatif-npv">
            {result.npv == null ? unknown : fmtMoney(result.npv)}
          </dd>
        </div>
        <div className="kpi">
          <dt className="l">
            {t('economics.whatifRoi')}
            {yourPrices}
          </dt>
          <dd className="v num" data-testid="whatif-roi">
            {result.roi == null ? unknown : fmtPct(result.roi)}
          </dd>
        </div>
      </dl>

      {materialRows.length > 0 && (
        <PriceTable rows={materialRows} drafts={drafts} onDraftChange={setDraft} onReset={reset} />
      )}

      <div className="text-sm text-[var(--ink-muted)]">
        <b>{t('economics.whatifAssumptions')}</b>
        <ul className="list-disc ml-5 mt-1">
          <li>{t('economics.whatifAssumptionPrevent')}</li>
          <li>{t('economics.whatifAssumptionRate')}</li>
          <li>{t('economics.whatifAssumptionRoi')}</li>
          {priceAssumed && <li>{t('economics.whatifAssumptionPrice')}</li>}
          {usingUserPrices && <li>{t('economics.whatifPriceAssumption')}</li>}
        </ul>
      </div>
    </section>
  );
}
