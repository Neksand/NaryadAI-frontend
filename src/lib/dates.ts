// Даты строго дд.мм.гггг, чч:мм — собираем вручную, а не через Intl,
// чтобы в WebView/APK без ICU не выпадал английский формат.
// Формат одинаков для ru и kk (только цифры), lang оставлен для API.

export function formatDT(value: string | number | Date | null | undefined, _lang = 'ru'): string {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatD(value: string | number | Date | null | undefined, lang = 'ru'): string {
  const full = formatDT(value, lang);
  return full ? full.split(',')[0] : '';
}
