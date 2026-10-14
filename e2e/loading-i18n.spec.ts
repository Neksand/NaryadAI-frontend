import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: worker home loading + i18n against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks.
// NOTE: seeded worker01 always owns live orders, so instead of a mocked
// empty state we assert that loading settles into live order cards.
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

async function loginAsWorker(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('worker01');
  await inputs.nth(1).fill('1001');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
}

test('live: worker home settles loading into live order cards', async ({ page }) => {
  await loginAsWorker(page);
  // Скелетон уходит, появляются живые карточки seeded-нарядов.
  await expect(page.locator('a[href*="/worker/orders/"]').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 15000 });
});

test('live: kazakh language persists without logout', async ({ page }) => {
  await loginAsWorker(page);
  const select = page.getByRole('combobox', { name: /language|тіл/i });
  await expect(select).toBeVisible({ timeout: 20000 });
  await select.selectOption('kk');
  await expect(select).toHaveValue('kk', { timeout: 15000 });
  expect(await page.evaluate(() => localStorage.getItem('naryadai.lang'))).toBe('kk');
  await expect(page).not.toHaveURL(/\/login/);
});
