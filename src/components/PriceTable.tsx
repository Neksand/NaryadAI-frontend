import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Одна позиция материалов из analyticsGet('materials'). Цены там нет — только кол-во. */
export interface MaterialRow {
  id: string;
  name: string;
  qty: number | null;
  unit?: string;
}

/** Введённые мастером цены: id материала → цена за единицу. Хранятся в localStorage. */
export type PriceMap = Record<string, number>;
/** Черновики полей ввода: id → сырая строка (пустая/невалидная не коммитится в PriceMap). */
export type PriceDrafts = Record<string, string>;

const NAME_KEYS = ['name', 'material_name', 'title', 'material', 'label'];
const QTY_KEYS = ['qty', 'quantity', 'qty_total', 'total_qty'];
const UNIT_KEYS = ['unit', 'uom', 'measure'];
const ID_KEYS = ['id', 'material_id', 'code', 'key'];

function toNum(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function pickNumFrom(obj: Record<string, unknown>, keys: string[]): number | null {
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

/**
 * Достаёт список материалов из ответа analyticsGet('materials'):
 * голый массив или конверты {items}/{data}. Строки без названия пропускаем,
 * кол-во без числа → qty null (позиция не считается, покажет пометку).
 */
export function parseMaterialRows(data: unknown): MaterialRow[] {
  return rowsOf(data)
    .map((r, i): MaterialRow | null => {
      if (!r || typeof r !== 'object') return null;
      const name = pickStr(r, NAME_KEYS);
      if (!name) return null;
      const id = pickStr(r, ID_KEYS) ?? `${i}`;
      return {
        id,
        name,
        qty: pickNumFrom(r, QTY_KEYS),
        unit: pickStr(r, UNIT_KEYS) ?? undefined,
      };
    })
    .filter((r): r is MaterialRow => r !== null);
}

export type PriceParse =
  { status: 'empty' } | { status: 'ok'; value: number } | { status: 'invalid' };

/**
 * Валидация цены: пусто → empty (позиция исключается), конечное число ≥ 0 → ok,
 * всё остальное (минус, мусор, Infinity) → invalid и отклоняется.
 */
export function parsePriceInput(raw: string): PriceParse {
  const s = raw.replace(/\s+/g, '').replace(',', '.');
  if (s === '') return { status: 'empty' };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { status: 'invalid' };
  return { status: 'ok', value: n };
}

/** Из черновиков — только закоммиченные валидные цены. */
export function validPricesOf(drafts: PriceDrafts): PriceMap {
  const out: PriceMap = {};
  for (const [id, raw] of Object.entries(drafts)) {
    const p = parsePriceInput(raw);
    if (p.status === 'ok') out[id] = p.value;
  }
  return out;
}

export interface MaterialsCost {
  /** Σ(qty × цена) по позициям с ценой; null — ни одной цены не введено. */
  total: number | null;
  pricedCount: number;
  unpricedCount: number;
}

/**
 * monthlyMaterialsCost по ценам мастера: sum(qty × price).
 * Позиция без цены (или без кол-ва) исключается из суммы.
 */
export function calcMaterialsCost(rows: MaterialRow[], prices: PriceMap): MaterialsCost {
  let total = 0;
  let pricedCount = 0;
  for (const row of rows) {
    const price = prices[row.id];
    if (row.qty == null || price == null || !Number.isFinite(price) || price < 0) continue;
    total += row.qty * price;
    pricedCount += 1;
  }
  return {
    total: pricedCount > 0 ? total : null,
    pricedCount,
    unpricedCount: rows.length - pricedCount,
  };
}

/** Ключ localStorage с изоляцией по пользователю — как offline-очередь. */
export const WHATIF_PRICES_STORE_KEY = 'naryadai.whatif-prices';

export function whatIfPricesKey(userId: string): string {
  return `${WHATIF_PRICES_STORE_KEY}:${userId || 'anonymous'}`;
}

function storageGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* переполнено/запрещено — цены просто не сохранятся */
  }
}

function storageRemove(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Читает сохранённые цены пользователя; битый/чужой мусор отбрасывается. */
export function loadWhatIfPrices(userId: string): PriceMap {
  const raw = storageGet(whatIfPricesKey(userId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: PriceMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveWhatIfPrices(userId: string, prices: PriceMap): void {
  const clean: PriceMap = {};
  for (const [k, v] of Object.entries(prices)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[k] = v;
  }
  storageSet(whatIfPricesKey(userId), JSON.stringify(clean));
}

function toDrafts(prices: PriceMap): PriceDrafts {
  return Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, String(v)]));
}

/**
 * Черновики цен с персистентностью per-user. Коммит в localStorage идёт только
 * из обработчиков (setDraft/reset) — смена пользователя чужое не затирает.
 */
export function useMaterialPrices(userId: string) {
  const [state, setState] = useState(() => ({
    userId,
    drafts: toDrafts(loadWhatIfPrices(userId)),
  }));
  // Смена пользователя — подтягиваем его цены (sync во время рендера,
  // React тут же перерендерит без коммита старого; чужое не затираем,
  // т.к. запись в localStorage идёт только из обработчиков ниже).
  if (state.userId !== userId) {
    setState({ userId, drafts: toDrafts(loadWhatIfPrices(userId)) });
  }
  const drafts = state.userId === userId ? state.drafts : toDrafts(loadWhatIfPrices(userId));

  const setDraft = useCallback(
    (id: string, raw: string) => {
      setState((prev) => {
        const next = { ...prev.drafts, [id]: raw };
        saveWhatIfPrices(userId, validPricesOf(next));
        return { userId, drafts: next };
      });
    },
    [userId],
  );

  const reset = useCallback(() => {
    setState({ userId, drafts: {} });
    storageRemove(whatIfPricesKey(userId));
  }, [userId]);

  return { drafts, setDraft, reset };
}

function fmtMoney(v: number): string {
  return `${Math.round(v).toLocaleString('ru-RU')} ₸`;
}

export interface PriceTableProps {
  rows: MaterialRow[];
  drafts: PriceDrafts;
  onDraftChange: (id: string, raw: string) => void;
  onReset: () => void;
}

/** Таблица ручного ввода цен за единицу. Без цен API — мастер вводит сам. */
export function PriceTable({ rows, drafts, onDraftChange, onReset }: PriceTableProps) {
  const { t } = useTranslation();
  const priced = useMemo(() => validPricesOf(drafts), [drafts]);
  const hasAny = Object.keys(priced).length > 0;

  return (
    <section className="flex flex-col gap-2" aria-label={t('economics.whatifPriceTable')}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-[15px]">{t('economics.whatifPriceTable')}</h3>
        <button
          type="button"
          className="btn btn-sm"
          data-testid="price-reset"
          disabled={!hasAny && Object.keys(drafts).length === 0}
          onClick={onReset}
        >
          {t('economics.whatifPriceReset')}
        </button>
      </div>
      <div className="card overflow-x-auto !p-0">
        <table className="tbl" data-testid="price-table">
          <thead>
            <tr>
              <th>{t('economics.whatifPriceName')}</th>
              <th>{t('economics.whatifPriceQty')}</th>
              <th>{t('economics.whatifPricePerUnit')}</th>
              <th>{t('economics.whatifPriceSum')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const draft = drafts[row.id] ?? '';
              const parsed = parsePriceInput(draft);
              const invalid = parsed.status === 'invalid';
              const price = parsed.status === 'ok' ? parsed.value : null;
              const line = price != null && row.qty != null ? row.qty * price : null;
              return (
                <tr key={row.id} data-testid={`price-row-${row.id}`}>
                  <td>{row.name}</td>
                  <td className="num">
                    {row.qty == null ? '—' : `${row.qty}${row.unit ? ` ${row.unit}` : ''}`}
                  </td>
                  <td>
                    <input
                      className="input !w-32"
                      type="text"
                      inputMode="decimal"
                      value={draft}
                      data-testid={`price-input-${row.id}`}
                      aria-label={`${row.name}: ${t('economics.whatifPricePerUnit')}`}
                      aria-invalid={invalid || undefined}
                      onChange={(e) => onDraftChange(row.id, e.target.value)}
                    />
                    {invalid && (
                      <div className="text-xs text-[var(--danger)]" role="alert">
                        {t('economics.whatifPriceInvalid')}
                      </div>
                    )}
                    {!invalid && price == null && (
                      <div className="text-xs text-[var(--ink-muted)]">
                        {t('economics.whatifPriceExcluded')}
                      </div>
                    )}
                  </td>
                  <td className="num" data-testid={`price-sum-${row.id}`}>
                    {line == null ? '—' : fmtMoney(line)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
