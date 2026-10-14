import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: worker navigation (deep link, back/forward, unknown route) against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks. ID наряда для диплинка берём из живого списка /worker
// (мокового order-123 на стенде нет).
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

async function loginAsWorker(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('worker01');
  await inputs.nth(1).fill('1001');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
}

test('live: deep link to a live order card opens after session restore', async ({ page }) => {
  await loginAsWorker(page);
  await page.goto('/worker', { waitUntil: 'domcontentloaded' });
  const firstLink = page.locator('a[href*="/worker/orders/"]').first();
  await expect(firstLink).toBeVisible({ timeout: 20000 });
  const href = await firstLink.getAttribute('href');
  expect(href).toMatch(/\/worker\/orders\//);

  // Прямой диплинк на живой наряд: карточка открывается, сессия цела.
  await page.goto(href!, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/worker\/orders\//, { timeout: 20000 });
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 20000 });
});

test('live: back/forward between /worker and /notifications keeps session', async ({ page }) => {
  await loginAsWorker(page);
  await page.goto('/worker', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Наряды').first()).toBeVisible({ timeout: 20000 });

  await page.getByRole('link', { name: 'Уведомления' }).click();
  await expect(page).toHaveURL(/\/notifications/, { timeout: 20000 });

  await page.goBack();
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
  await expect(page).not.toHaveURL(/\/login/);

  await page.goForward();
  await expect(page).toHaveURL(/\/notifications/, { timeout: 20000 });
  await expect(page).not.toHaveURL(/\/login/);
  // Кнопка «Прочитать все» рендерится всегда (disabled во время загрузки).
  await expect(page.getByRole('button', { name: 'Прочитать все' })).toBeVisible({ timeout: 20000 });
});

test('live: unknown route redirects to role home', async ({ page }) => {
  await loginAsWorker(page);
  await page.goto('/definitely-unknown-route-xyz', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText('Наряды').first()).toBeVisible({ timeout: 20000 });
});
