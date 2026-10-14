import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: language + board preferences against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks.
// CI-guard: without a live stand the tests skip (no live API in CI);
// with the stand up they run for real.

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

async function loginAs(page: Page, login: string, pin: string, home: RegExp) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(login);
  await inputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(home, { timeout: 20000 });
}

const langSelect = (page: Page) => page.getByRole('combobox', { name: /language|тіл/i });

test('live: language RU/KZ persists without dropping login', async ({ page }) => {
  await loginAs(page, 'worker01', '1001', /\/worker/);
  await expect(langSelect(page)).toBeVisible({ timeout: 20000 });

  await langSelect(page).selectOption('kk');
  await expect(langSelect(page)).toHaveValue('kk', { timeout: 15000 });
  expect(await page.evaluate(() => localStorage.getItem('naryadai.lang'))).toBe('kk');
  // Сессия жива: не выкинуло на /login, refresh-токен на месте.
  await expect(page).not.toHaveURL(/\/login/);
  expect(await page.evaluate(() => localStorage.getItem('naryadai.refresh'))).not.toBeNull();

  await langSelect(page).selectOption('ru');
  await expect(langSelect(page)).toHaveValue('ru', { timeout: 15000 });
  expect(await page.evaluate(() => localStorage.getItem('naryadai.lang'))).toBe('ru');
  await expect(page).not.toHaveURL(/\/login/);
});

test('live: chosen language survives reload with session intact', async ({ page }) => {
  await loginAs(page, 'worker01', '1001', /\/worker/);
  await expect(langSelect(page)).toBeVisible({ timeout: 20000 });

  await langSelect(page).selectOption('kk');
  await expect(langSelect(page)).toHaveValue('kk', { timeout: 15000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(langSelect(page)).toHaveValue('kk', { timeout: 20000 });
  expect(await page.evaluate(() => localStorage.getItem('naryadai.lang'))).toBe('kk');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
});

test('live: board display preference survives reload', async ({ page }) => {
  await loginAs(page, 'master1', '3333', /\/master/);
  await page.goto('/master/board', { waitUntil: 'domcontentloaded' });
  const issuedToggle = page.getByRole('button', { name: /Выдан/ });
  await expect(issuedToggle).toBeVisible({ timeout: 20000 });

  await expect(issuedToggle).toHaveAttribute('aria-expanded', 'true');
  await issuedToggle.click();
  await expect(issuedToggle).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => localStorage.getItem('naryadai.board-open'))).toContain(
    '"issued":false',
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  // Свернутая колонка осталась свернутой (персистентность), сессия жива.
  await expect(page.getByRole('button', { name: /Выдан/ })).toHaveAttribute(
    'aria-expanded',
    'false',
    { timeout: 20000 },
  );
  await expect(page).not.toHaveURL(/\/login/);
});
