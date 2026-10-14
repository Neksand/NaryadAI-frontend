import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: /master/board against the real API http://127.0.0.1:8080/api/v1
// (through the vite dev-server /api proxy). No page.route mocks.
// CI-guard copied from e2e/live-smoke.spec.ts: without a live stand the
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

async function loginAsMaster(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('master1');
  await inputs.nth(1).fill('3333');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/master/, { timeout: 20000 });
}

test('live: master board shows columns and order cards', async ({ page }) => {
  await loginAsMaster(page);
  await page.goto('/master/board', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Доска').first()).toBeVisible({ timeout: 20000 });
  // Шесть колонок-статусов рендерятся всегда (MasterBoard.COLS).
  await expect(page.locator('section[aria-label]')).toHaveCount(6, { timeout: 20000 });
  // Толерантно к данным: либо карточки нарядов, либо пустые колонки — но доска не висит в загрузке/ошибке.
  await expect(async () => {
    const cards = await page.locator('a[href*="/master/orders/"]').count();
    const empty = await page.getByText('Пока пусто').count();
    expect(cards + empty).toBeGreaterThan(0);
  }).toPass({ timeout: 20000 });
});

test('live: master board filter change does not crash', async ({ page }) => {
  await loginAsMaster(page);
  await page.goto('/master/board', { waitUntil: 'domcontentloaded' });
  const filter = page.getByLabel('Наряды');
  await expect(filter).toBeVisible({ timeout: 20000 });
  await filter.selectOption('issued');
  await expect(page.getByText('Доска').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('section[aria-label]')).toHaveCount(6, { timeout: 20000 });
  await filter.selectOption('');
  await expect(page.getByText('Доска').first()).toBeVisible({ timeout: 20000 });
});
