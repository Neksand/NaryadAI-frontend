import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: /admin employees against the real API http://127.0.0.1:8080/api/v1
// (through the vite dev-server /api proxy). No page.route mocks.
// CI-guard copied from e2e/live-smoke.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.
//
// МУТАЦИИ — только строго изолированные: создаём сотрудника с уникальным
// логином e2e-<timestamp>, сброс PIN — только ему, затем удаляем его же
// через UI (DELETE /dict/employees/:id, см. deleteDict в src/api/misc.ts).
// afterEach подчищает остатки e2e-* через API, если UI-удаление не сработало.

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

async function openEmployees(page: Page) {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tablist', { name: 'Админ' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Сотрудники' }).click();
  await expect(page.getByText('Новый сотрудник')).toBeVisible({ timeout: 20000 });
}

/** API-подчистка: удаляет сотрудников с заданным префиксом логина. Возвращает итог строкой. */
async function deleteEmployeesByPrefix(page: Page, prefix: string): Promise<string> {
  return await page.evaluate(async (pfx) => {
    try {
      const refresh = localStorage.getItem('naryadai.refresh');
      if (!refresh) return 'no-refresh-token';
      const r = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!r.ok) return `refresh-failed:${r.status}`;
      const tokens = await r.json();
      const at = tokens.access_token as string;
      // Бэкенд ротирует refresh-токен: кладём свежий обратно, чтобы
      // последующие refresh (in-test sweep, afterEach) не получали 401.
      if (tokens.refresh_token) localStorage.setItem('naryadai.refresh', tokens.refresh_token);
      const auth = { Authorization: `Bearer ${at}` };
      const l = await fetch('/api/v1/dict/employees', { headers: auth });
      if (!l.ok) return `list-failed:${l.status}`;
      const data = await l.json();
      const items = (data.items ?? []) as { id: string; login?: string }[];
      const hits = items.filter((e) => (e.login ?? '').startsWith(pfx));
      const out: string[] = [];
      for (const h of hits) {
        const del = await fetch(`/api/v1/dict/employees/${h.id}`, {
          method: 'DELETE',
          headers: auth,
        });
        out.push(`${h.login}:${del.status}`);
      }
      return hits.length ? `deleted[${out.join(',')}]` : 'nothing-to-clean';
    } catch (e) {
      return `cleanup-error:${String(e)}`;
    }
  }, prefix);
}

test.afterEach(async ({ page }, testInfo) => {
  // Подчищаем только наши e2e-логины; при скипе (нет стенда) тихо выходим.
  if (testInfo.status === 'skipped') return;
  try {
    const res = await deleteEmployeesByPrefix(page, 'e2e-');
    // eslint-disable-next-line no-console
    console.log(`[cleanup] admin-employees afterEach: ${res}`);
  } catch {
    /* best effort */
  }
});

test('live: admin employees list is non-empty', async ({ page }) => {
  await loginAsAdmin(page);
  await openEmployees(page);
  await expect(async () => {
    const n = await page.locator('table.tbl tbody tr').count();
    expect(n).toBeGreaterThan(0);
  }).toPass({ timeout: 20000 });
});

test('live: admin create form validates empty PIN (no submit)', async ({ page }) => {
  await loginAsAdmin(page);
  await openEmployees(page);
  await page.getByLabel('Логин').fill('e2e-nopin-check');
  await page.getByLabel('ФИО').fill('Е2Е Без Пина');
  // ПИН не заполнен — кнопка заблокирована, мутации нет.
  await expect(page.getByPlaceholder('ПИН 4–8 цифр')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать +' })).toBeDisabled();
});

test('live: create e2e-employee -> reset PIN -> delete (cleanup)', async ({ page }) => {
  await loginAsAdmin(page);
  await openEmployees(page);
  const login = `e2e-${Date.now()}`;

  // 1. Создание с уникальным логином.
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('ФИО').fill('Е2Е Временный');
  await page.getByPlaceholder('ПИН 4–8 цифр').fill('1234');
  const createBtn = page.getByRole('button', { name: 'Создать +' });
  await expect(createBtn).toBeEnabled({ timeout: 15000 });
  const [createResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/dict/employees') && r.request().method() === 'POST',
      { timeout: 20000 },
    ),
    createBtn.click(),
  ]);
  expect(createResp.ok()).toBeTruthy();
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 20000 });

  // 2. Строка созданного видна в живом списке.
  const row = page.locator('table.tbl tbody tr', { hasText: login });
  await expect(row).toBeVisible({ timeout: 20000 });

  // 3. Сброс PIN — только что созданному.
  await row.getByPlaceholder('новый ПИН').fill('5678');
  await row.getByRole('button', { name: 'ПИН', exact: true }).click();
  await expect(page.getByText('ПИН обновлён')).toBeVisible({ timeout: 20000 });

  // 4. Удаление через UI (DELETE /dict/employees/:id).
  const row2 = page.locator('table.tbl tbody tr', { hasText: login });
  await expect(row2).toBeVisible({ timeout: 20000 });
  await row2.getByRole('button', { name: 'Удалить' }).click();
  await row2.getByRole('button', { name: 'Точно удалить?' }).click();
  await expect(page.getByText('Пользователь удалён')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('table.tbl tbody tr', { hasText: login })).toHaveCount(0, {
    timeout: 20000,
  });

  // 5. Страховочная API-подчистка (ничего не должна найти).
  const res = await deleteEmployeesByPrefix(page, login);
  // eslint-disable-next-line no-console
  console.log(`[cleanup] create/delete test sweep for ${login}: ${res}`);
  expect(res).toBe('nothing-to-clean');
});
