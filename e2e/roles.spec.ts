import { expect, test, type Page } from '@playwright/test';

// Live against the real API http://127.0.0.1:8080 (via vite dev-server /api proxy).
// Real logins, real role-guard redirects. No page.route mocks.
//
// CI-guard copied from e2e/live-smoke.spec.ts (needs the dev-server origin for fetch):
// without a live API the specs skip (CI has no stand), locally with the stand up
// they run for real.

async function gotoLogin(page: Page) {
  // NB: page.addInitScript выполняется на КАЖДОЙ навигации, поэтому здесь только
  // идемпотентная установка языка. Токены чистим через evaluate + reload ниже —
  // иначе init-скрипт стирал бы refresh после живого логина и повторный
  // page.goto разлогинивал бы пользователя.
  await page.addInitScript(() => {
    localStorage.setItem('naryadai.lang', 'ru');
  });
  await page.goto('/login');
  // Чистый старт без сессии.
  await page.evaluate(() => {
    localStorage.removeItem('naryadai.refresh');
    localStorage.removeItem('naryadai.cached-user.v1');
  });
  await page.reload();
  // Живой API за vite-прокси: любой HTTP-ответ от /api/v1/* (включая 401) = стенд поднят.
  const live = await page
    .evaluate(async () => {
      try {
        const _liveRes = await fetch('/api/v1/me', { method: 'GET' });
        return _liveRes.status < 500;
      } catch {
        return false;
      }
    })
    .catch(() => false);
  test.skip(!live, 'no live API stand — run backend e2e_stand + uvicorn first');
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible({ timeout: 15000 });
}

async function loginAs(page: Page, login: string, pin: string, home: RegExp) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(login);
  await inputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(home, { timeout: 20000 });
}

test('live: worker01 is redirected from /admin to role home', async ({ page }) => {
  await loginAs(page, 'worker01', '1001', /\/worker/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
  await expect(page.getByText('Наряды').first()).toBeVisible({ timeout: 15000 });
});

test('live: manager1 is redirected from /master/new to role home', async ({ page }) => {
  await loginAs(page, 'manager1', '2222', /\/manager/);
  await page.goto('/master/new');
  await expect(page).toHaveURL(/\/manager/, { timeout: 20000 });
});

test('live: anonymous user is redirected to /login', async ({ page }) => {
  await gotoLogin(page);
  // Сессия уже пустая (gotoLogin чистит refresh), прямой заход на закрытый роут.
  await page.goto('/manager');
  await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
});
