// Нормализация человеческого ввода: трим только краёв.
// Пароли, ID, ключи, файлы не трогаем. Серверная валидация обязательна.
// Нормализация выполняется ДО расчёта Idempotency-Key, чтобы случайные
// пробелы по краям не создавали дубль-наряд после потери ответа сети.

export function trimEdges(value: string): string {
  return value.replace(
    /^[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$/g,
    '',
  );
}

/** Нормализовать поля формы создания/перехода: description, comment, reason comment. */
export function normalizeOrderText<T extends Record<string, unknown>>(
  body: T,
  keys = ['description', 'comment', 'work_done_text'],
): T {
  const out: Record<string, unknown> = { ...body };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === 'string') out[k] = trimEdges(v);
  }
  const form = out['form'];
  if (form && typeof form === 'object') {
    out['form'] = normalizeOrderText(form as Record<string, unknown>, [
      'work_done_text',
      'comment',
    ]);
  }
  return out as T;
}
