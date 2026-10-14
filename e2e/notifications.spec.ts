import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: notifications inbox against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks. Seeded worker01 has live WORK_ORDER_ASSIGNED
// notifications («Новый наряд»).
// CI-guard: without a live stand the tests skip (no live API in CI).

async function gotoLogin(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-boot-cleaned')) return;
    sessionStorage.setItem('e2e-boot-cleaned', '1');
    localStorage.removeItem('naryadai.refresh');
    localStorage.removeItem('naryadai.cached-user.v1');
    localStorage.setItem('naryadai.lang', 'ru');
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
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

test('live: worker sees live notifications inbox', async ({ page }) => {
  await loginAsWorker(page);
  await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  // Живые уведомления стенда рендерятся карточками; ждём хотя бы одну.
  await expect
    .poll(async () => page.locator('main .card').count(), { timeout: 20000 })
    .toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: /Прочитать/ })).toBeVisible({ timeout: 15000 });
});

test('live: notifications persist language without logout', async ({ page }) => {
  await loginAsWorker(page);
  await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('combobox', { name: /language|тіл/i })).toBeVisible({
    timeout: 20000,
  });
  await expect(page).not.toHaveURL(/\/login/);
});
