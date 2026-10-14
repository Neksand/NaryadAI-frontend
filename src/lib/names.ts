// Двуязычные справочники: у записей есть name (ru) и name_kk.
// Показ зависит от языка интерфейса; пустой name_kk откатывается на name.

export interface Bilingual {
  name?: string | null;
  name_kk?: string | null;
  full_name?: string | null;
  login?: string | null;
}

export function pickName<T extends Bilingual>(item: T | null | undefined, lang: string): string {
  if (!item) return '';
  if (lang === 'kk' && item.name_kk && item.name_kk.trim()) return item.name_kk;
  return item.name ?? '';
}

export function pickPersonName(item: Bilingual | null | undefined, lang: string): string {
  if (!item) return '';
  if (item.full_name) return item.full_name;
  return pickName(item, lang) || item.login || '';
}

/** Для админки: оба названия «RU / KK», чтобы видеть незаполненное. */
export function dualName(item: Bilingual | null | undefined): string {
  const ru = (item?.name ?? '').trim();
  const kk = (item?.name_kk ?? '').trim();
  if (ru && kk && ru !== kk) return `${ru} / ${kk}`;
  return ru || kk;
}
