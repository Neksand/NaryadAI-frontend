import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: manager analytics edge states against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks: искусственную 500ку на живом стенде не вызвать,
// поэтому проверяем толерантно — секция рейтинга жива с данными ИЛИ с
// EmptyState, алерт (если есть) всегда идёт в паре с «Повторить», reload
// страницу не убивает.
// CI-guard copied from e2e/manager-areas.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.

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

async function loginAsManager(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('manager1');
  await inputs.nth(1).fill('2222');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/manager/, { timeout: 20000 });
}

test('live: ratings section renders with live data or empty state', async ({ page }) => {
  await loginAsManager(page);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Рейтинг' })).toBeVisible({ timeout: 20000 });
  // Секция рейтинга settle: строки таблицы, EmptyState или алерт.
  // Poll вместо .or() — несколько веток могут быть видны одновременно.
  await expect
    .poll(
      async () => {
        const rows = await page.locator('table.tbl tbody tr').count();
        const empty = await page.getByText('Пока пусто').count();
        const alerts = await page.getByRole('alert').count();
        return rows + empty + alerts;
      },
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  // Живой сид даёт таблицу рейтинга; при пустой базе — «Пока пусто»,
  // при ошибке API — алерт в паре с «Повторить».
  const rows = await page.locator('table.tbl tbody tr').count();
  const alerts = await page.getByRole('alert').count();
  if (rows === 0 && alerts === 0) {
    await expect(page.getByText('Пока пусто').first()).toBeVisible({ timeout: 20000 });
  } else if (alerts > 0) {
    await expect(page.getByRole('button', { name: 'Повторить' }).first()).toBeVisible({
      timeout: 20000,
    });
  } else {
    expect(rows).toBeGreaterThan(0);
  }
});

test('live: analytics shows no blocking alert, or alert pairs with retry', async ({ page }) => {
  await loginAsManager(page);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  // Ждём settle низа страницы: строки рейтинга либо EmptyState (poll вместо .or()).
  await expect
    .poll(
      async () => {
        const rows = await page.locator('table.tbl tbody tr').count();
        const empty = await page.getByText('Пока пусто').count();
        return rows + empty;
      },
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  const alerts = await page.getByRole('alert').count();
  if (alerts > 0) {
    await expect(page.getByRole('button', { name: 'Повторить' }).first()).toBeVisible({
      timeout: 20000,
    });
  } else {
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});

test('live: reload after analytics load keeps page alive', async ({ page }) => {
  await loginAsManager(page);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Рейтинг' })).toBeVisible({ timeout: 20000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Рейтинг' })).toBeVisible({ timeout: 20000 });
});
