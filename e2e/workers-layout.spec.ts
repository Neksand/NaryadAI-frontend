import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: master team/board readability + no horizontal overflow against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks. Длинных имён из моков в живом сиде нет — проверяем
// инвариант на живых данных: имена/карточки не шире вьюпорта, overflow ≤ 1px.
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

async function loginAsMaster(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('master1');
  await inputs.nth(1).fill('3333');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/master/, { timeout: 20000 });
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('live: team names stay readable on desktop without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsMaster(page);
  await page.goto('/master', { waitUntil: 'domcontentloaded' });
  // Живые исполнители (сид: 15) либо счётчик (0) — страница не падает.
  await expect(page.getByText(/Исполнители/).first()).toBeVisible({ timeout: 20000 });
  await noHorizontalOverflow(page);
});

test('live: team names stay readable on mobile without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsMaster(page);
  await page.goto('/master', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Исполнители/).first()).toBeVisible({ timeout: 20000 });
  const name = page.locator('section span.font-semibold').first();
  if ((await name.count()) > 0) {
    const nameBox = await name.boundingBox();
    expect(nameBox?.width).toBeLessThanOrEqual(390);
  }
  await noHorizontalOverflow(page);
});

test('live: board cards stay readable on mobile without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsMaster(page);
  await page.goto('/master/board', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Выдан \(\d+\)/ }).first()).toBeVisible({
    timeout: 20000,
  });
  const card = page.locator('a.card').first();
  if ((await card.count()) > 0) {
    await expect(card).toBeVisible({ timeout: 20000 });
    const cardBox = await card.boundingBox();
    expect(cardBox?.width).toBeLessThanOrEqual(390);
  }
  await noHorizontalOverflow(page);
});
