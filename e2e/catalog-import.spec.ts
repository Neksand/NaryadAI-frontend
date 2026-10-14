import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.setTimeout(60_000);
// Один живой стенд на всех воркеров: тесты файла идут строго серийно, иначе
// afterEach-подчистка e2e-* параллельного теста снесёт e2e-ok-* записи
// импорт-теста между apply и проверкой.
test.describe.configure({ mode: 'serial' });

// Live: /admin Excel-импорт справочников против реального API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks.
// CI-guard copied from e2e/manager-areas.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.
//
// Фикстуры e2e/fixtures/import-{ok,bad}.xlsx собраны scripts/make-import-fixtures.py
// (stdlib-only: минимальный .xlsx как zip XML-частей, без openpyxl в системном
// python3; читаемость проверена openpyxl из backend-venv — тем же ридером,
// что использует эндпоинт). import-ok: equipment, 2 валидные строки
// (inventory_no e2e-ok-*); import-bad: строка 3 с пустым name + criticality=Z.
// Бэкенд: POST /api/v1/dict/{equipment|materials}/import (multipart file,
// query dry_run, только admin). dry_run=true -> {rows, errors[]} без записи;
// dry_run=false -> {created, updated} атомарно; ошибки {row, path, message}
// с excel-номером строки.

async function gotoLogin(page: Page) {
  // NOTE: addInitScript выполняется при КАЖДОЙ навигации, поэтому чистка
  // одноразовая (sessionStorage-флаг): иначе второй goto стёр бы свежий
  // refresh-токен и нас выкинуло бы обратно на /login.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-boot-cleaned')) return;
    sessionStorage.setItem('e2e-boot-cleaned', '1');
    localStorage.removeItem('naryadai.refresh');
    localStorage.removeItem('naryadai.cached-user.v1');
    localStorage.setItem('naryadai.lang', 'ru');
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // Живой API за vite-прокси: любой HTTP-ответ от /api/v1/* (включая 401) = стенд поднят.
  // Ретраи: dev-сервер под параллельной нагрузкой может на секунды подвисать —
  // скипаемся только если стенд стабильно недоступен.
  const live = await page
    .evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        try {
          await fetch('/api/v1/me', { method: 'GET', signal: AbortSignal.timeout(8000) });
          return true;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      return false;
    })
    .catch(() => false);
  test.skip(!live, 'no live API stand — run backend e2e_stand + uvicorn first');
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible({ timeout: 20000 });
}

async function loginAsAdmin(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('1234');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20000 });
}

async function openEquipmentImport(page: Page) {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tablist', { name: 'Админ' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Оборудование' }).click();
  await expect(page.getByText('Импорт из Excel')).toBeVisible({ timeout: 20000 });
}

async function attachFixture(page: Page, name: 'import-ok.xlsx' | 'import-bad.xlsx') {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(dir, 'fixtures', name);
  await page.getByLabel('Excel-файл (.xlsx)').setInputFiles(file);
}

/** API-подчистка отдельным запросным контекстом (своя admin-сессия через
 *  request-фикстуру): evaluate+refresh внутри page ротировал бы refresh-токен
 *  живой UI-сессии и уронил бы последующие шаги теста. Удаляет оборудование
 *  с заданным префиксом inventory_no (DELETE /dict/equipment/:id). */
async function deleteEquipmentByPrefix(
  request: APIRequestContext,
  prefix: string,
): Promise<string> {
  try {
    const login = await request.post('/api/v1/auth/login', {
      data: { login: 'admin', pin: '1234' },
    });
    if (!login.ok()) return `login-failed:${login.status()}`;
    const { access_token } = (await login.json()) as { access_token: string };
    const auth = { Authorization: `Bearer ${access_token}` };
    const l = await request.get('/api/v1/dict/equipment', { headers: auth });
    if (!l.ok()) return `list-failed:${l.status()}`;
    const data = (await l.json()) as { items?: { id: string; inventory_no?: string }[] };
    const hits = (data.items ?? []).filter((e) => (e.inventory_no ?? '').startsWith(prefix));
    const out: string[] = [];
    for (const h of hits) {
      const del = await request.delete(`/api/v1/dict/equipment/${h.id}`, { headers: auth });
      out.push(`${h.inventory_no}:${del.status()}`);
    }
    return hits.length ? `deleted[${out.join(',')}]` : 'nothing-to-clean';
  } catch (e) {
    return `cleanup-error:${String(e)}`;
  }
}

test.afterEach(async ({ request }, testInfo) => {
  if (testInfo.status === 'skipped') return;
  try {
    const res = await deleteEquipmentByPrefix(request, 'e2e-');
    // eslint-disable-next-line no-console
    console.log(`[cleanup] catalog-import afterEach: ${res}`);
  } catch {
    /* best effort */
  }
});

test('live: dry-run bad file shows row-numbered errors, writes nothing', async ({
  page,
  request,
}) => {
  await loginAsAdmin(page);
  await openEquipmentImport(page);
  await attachFixture(page, 'import-bad.xlsx');
  const [previewResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/dict/equipment/import') && r.request().method() === 'POST',
      { timeout: 20000 },
    ),
    page.getByRole('button', { name: 'Проверить' }).click(),
  ]);
  expect(previewResp.ok()).toBeTruthy();
  // Одна валидная строка в preview + две ошибки с excel-номером строки 3.
  await expect(page.getByText('Строк: 1')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Ошибки')).toBeVisible({ timeout: 20000 });
  const row3 = page.getByText(/Строка 3/);
  await expect(row3).toHaveCount(2, { timeout: 20000 });
  await expect(page.getByText(/Строка 3.*name/)).toBeVisible();
  await expect(page.getByText(/Строка 3.*criticality/)).toBeVisible();
  // dry-run ничего не пишет: созданных e2e-bad-* нет.
  const leftovers = await deleteEquipmentByPrefix(request, 'e2e-bad-');
  expect(leftovers).toBe('nothing-to-clean');
});

test('live: dry-run valid file shows rows without errors', async ({ page }) => {
  await loginAsAdmin(page);
  await openEquipmentImport(page);
  await attachFixture(page, 'import-ok.xlsx');
  const [previewResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/dict/equipment/import') && r.request().method() === 'POST',
      { timeout: 20000 },
    ),
    page.getByRole('button', { name: 'Проверить' }).click(),
  ]);
  expect(previewResp.ok()).toBeTruthy();
  await expect(page.getByText('Строк: 2')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('e2e-ok-1')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Ошибки')).toHaveCount(0);
});

test('live: import valid file creates e2e-* records, then API cleanup', async ({
  page,
  request,
}) => {
  await loginAsAdmin(page);
  await openEquipmentImport(page);
  // Предчистка для детерминизма created/updated при повторных прогонах.
  await deleteEquipmentByPrefix(request, 'e2e-ok-');
  await attachFixture(page, 'import-ok.xlsx');
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByText('Строк: 2')).toBeVisible({ timeout: 20000 });

  // Импорт с подтверждением (двухклик): первый клик -> «Точно импортировать?».
  await page.getByRole('button', { name: 'Импортировать' }).click();
  const confirmBtn = page.getByRole('button', { name: 'Точно импортировать?' });
  await expect(confirmBtn).toBeVisible({ timeout: 10000 });
  const [applyResp] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/dict/equipment/import') &&
        r.url().includes('dry_run=false') &&
        r.request().method() === 'POST',
      { timeout: 20000 },
    ),
    confirmBtn.click(),
  ]);
  expect(applyResp.ok()).toBeTruthy();
  // DELETE в бэкенде мягкий (deleted_at), а existence-check импорта
  // (SELECT ... WHERE inventory_no=$1) deleted_at игнорирует и revive'ит строку:
  // первый прогон -> created:2, повторные -> updated:2. Детерминирован только итог.
  const resultChip = page.getByText(/Создано: \d+, обновлено: \d+/);
  await expect(resultChip).toBeVisible({ timeout: 20000 });
  const m = (/Создано: (\d+), обновлено: (\d+)/.exec((await resultChip.textContent()) ?? '') ??
    []) as RegExpExecArray;
  expect(Number(m[1]) + Number(m[2])).toBe(2);

  // Обе записи видимы через API (не soft-deleted).
  const login = await request.post('/api/v1/auth/login', {
    data: { login: 'admin', pin: '1234' },
  });
  expect(login.ok()).toBeTruthy();
  const { access_token } = (await login.json()) as { access_token: string };
  const list = await request.get('/api/v1/dict/equipment', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  expect(list.ok()).toBeTruthy();
  const items = ((await list.json()) as { items?: { inventory_no?: string }[] }).items ?? [];
  const invs = items.map((e) => e.inventory_no ?? '');
  expect(invs).toContain('e2e-ok-1');
  expect(invs).toContain('e2e-ok-2');

  // Удаление созданного через API (DELETE /dict/equipment/:id).
  const res = await deleteEquipmentByPrefix(request, 'e2e-ok-');
  // eslint-disable-next-line no-console
  console.log(`[cleanup] catalog-import import sweep: ${res}`);
  expect(res).toContain('e2e-ok-1:200');
  expect(res).toContain('e2e-ok-2:200');
  expect(await deleteEquipmentByPrefix(request, 'e2e-ok-')).toBe('nothing-to-clean');
});
