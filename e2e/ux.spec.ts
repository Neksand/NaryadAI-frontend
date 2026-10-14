import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: login UX + worker filter UX against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks.
// NOTE про трим логина: живьём перехватывать нечего (ответы — настоящий
// бэкенд), поэтому трим доказываем пассивным слушателем запроса:
// вводим '  nouser-ux  ', а в ушедшем POST /auth/login должен лежать
// login === 'nouser-ux'. Несуществующий логин — не жжём счётчик попыток
// seeded-аккаунтов. Ожидаем живые 401 + alert + остаёмся на /login.
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

test('live: login with surrounding spaces posts trimmed login (401, stays on /login)', async ({
  page,
}) => {
  let seenLogin: unknown = null;
  // Пассивный слушатель — только читаем ушедший запрос, ничего не мокаем.
  page.on('request', (req) => {
    if (req.url().includes('/api/v1/auth/login') && req.method() === 'POST') {
      try {
        seenLogin = (JSON.parse(req.postData() ?? '{}') as { login?: unknown }).login;
      } catch {
        /* ignore */
      }
    }
  });
  await gotoLogin(page);

  await page.locator('form input').first().fill('  nouser-ux  ');
  await page.locator('form input').nth(1).fill('0000');
  await page.getByRole('button', { name: 'Войти' }).click();
  // Живые 401: alert виден, остаёмся на /login.
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/\/login/);
  expect(seenLogin).toBe('nouser-ux');
});

test('live: Enter key submits the login form', async ({ page }) => {
  await gotoLogin(page);

  await page.locator('form input').first().fill('worker01');
  await page.locator('form input').nth(1).fill('1001');
  await page.locator('form input').nth(1).press('Enter');
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
});

test('live: filter tabs switch and reset restores live orders', async ({ page }) => {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('worker01');
  await inputs.nth(1).fill('1001');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
  const orderLinks = page.locator('a[href*="/worker/orders/"]');
  await expect(orderLinks.first()).toBeVisible({ timeout: 20000 });

  await page.getByRole('tab', { name: /Срочные/ }).click();
  // Вкладка переключилась (aria-selected), страница не упала.
  await expect(page.getByRole('tab', { name: /Срочные/ })).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 15000 },
  );

  await page.getByRole('tab', { name: /Сейчас в работе/ }).click();
  await expect(page.getByRole('tab', { name: /Сейчас в работе/ })).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 15000 },
  );
  await expect(orderLinks.first()).toBeVisible({ timeout: 20000 });
});
