import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: manager analytics summary states against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks: пустые/ошибочные состояния зависят от живых данных,
// поэтому ассёрты толерантные (карточки ИЛИ EmptyState, алерт ИЛИ его отсутствие).
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

test('live: analytics summary is readable with live data', async ({ page }) => {
  await loginAsManager(page);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Аналитика').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Динамика').first()).toBeVisible({ timeout: 20000 });
  // Живой сид даёт KPI/тренды/рейтинг; при пустой базе — EmptyState, а не белый экран.
  const kpis = await page.locator('.kpi .v').count();
  if (kpis === 0) {
    await expect(page.getByText('Пока пусто').first()).toBeVisible({ timeout: 20000 });
  } else {
    expect(kpis).toBeGreaterThan(0);
  }
});

test('live: analytics survives load — no fatal alert, or retry offered', async ({ page }) => {
  await loginAsManager(page);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tablist', { name: 'Аналитика' })).toBeVisible({ timeout: 20000 });
  // Здоровый стенд алертов не показывает; если бэкенд всё же ответил ошибкой —
  // рядом обязана быть кнопка «Повторить», а страница остаётся живой.
  const alerts = await page.getByRole('alert').count();
  if (alerts > 0) {
    await expect(page.getByRole('button', { name: 'Повторить' }).first()).toBeVisible({
      timeout: 20000,
    });
  }
  await expect(page.getByRole('tablist', { name: 'Аналитика' })).toBeVisible({ timeout: 20000 });
});

test('live: reload shows live summary again (no stale crash)', async ({ page }) => {
  await loginAsManager(page);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tablist', { name: 'Аналитика' })).toBeVisible({ timeout: 20000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('tablist', { name: 'Аналитика' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Динамика').first()).toBeVisible({ timeout: 20000 });
});
