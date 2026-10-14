import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: role redirects + forbidden-resource ErrorState against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks.
// NOTE: живой стенд отдаёт 404 «Наряд не найден» на неизвестный uuid —
// выделенного чужого наряда в сиде нет, поэтому 404 покрывает путь
// «ресурс недоступен» (ErrorState + retry), а редиректы ролей живьём.
// CI-guard: without a live stand the tests skip (no live API in CI).

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

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
          const _liveRes = await fetch('/api/v1/me', {
            method: 'GET',
            signal: AbortSignal.timeout(8000),
          });
          return _liveRes.status < 500;
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

async function loginAs(page: Page, login: string, pin: string, home: RegExp) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(login);
  await inputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(home, { timeout: 20000 });
}

test('live: worker is redirected from /admin to worker home', async ({ page }) => {
  await loginAs(page, 'worker01', '1001', /\/worker/);
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/worker/, { timeout: 15000 });
  await expect(page.getByText('Наряды').first()).toBeVisible({ timeout: 20000 });
});

test('live: guests go to /login and master is redirected from /manager', async ({ page }) => {
  await gotoLogin(page);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });

  const inputs = page.locator('form input');
  await inputs.nth(0).fill('master1');
  await inputs.nth(1).fill('3333');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/master/, { timeout: 20000 });

  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/master/, { timeout: 15000 });
});

test('live: worker opening an unknown order sees ErrorState (404, живьём)', async ({ page }) => {
  await loginAs(page, 'worker01', '1001', /\/worker/);
  await page.goto(`/worker/orders/${ZERO_UUID}`, { waitUntil: 'domcontentloaded' });
  // Живой 404 «Наряд не найден» → ErrorState (role=alert) с retry.
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('alert')).toContainText(/не найден|прав/i, { timeout: 15000 });
});
