import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: RU/KZ switching + Accept-Language against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks (Accept-Language собирается пассивным слушателем
// запросов — перехвата и подмены ответов нет).
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

test('live: переключение RU→KZ меняет ключевые строки', async ({ page }) => {
  await loginAsWorker(page);
  await expect(page.getByText('Наряды').first()).toBeVisible({ timeout: 20000 });
  await page.getByLabel(/language/i).selectOption('kk');
  // nav.orders RU «Наряды» → KK «Нарядтар», worker.done RU «Завершённые» → KK «Аяқталған».
  await expect(page.getByText('Нарядтар').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Аяқталған').first()).toBeVisible({ timeout: 15000 });
});

test('live: язык держится после reload через localStorage', async ({ page }) => {
  await loginAsWorker(page);
  await expect(page.getByText('Наряды').first()).toBeVisible({ timeout: 20000 });
  await page.getByLabel(/language/i).selectOption('kk');
  await expect(page.getByText('Нарядтар').first()).toBeVisible({ timeout: 15000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Нарядтар').first()).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => localStorage.getItem('naryadai.lang'))).toBe('kk');
});

test('live: Accept-Language уходит с API-запросом', async ({ page }) => {
  const langs: string[] = [];
  // Пассивный слушатель: только читаем заголовки живых запросов, ничего не мокаем.
  page.on('request', (req) => {
    if (req.url().includes('/api/v1/')) langs.push(req.headers()['accept-language'] ?? '');
  });
  await loginAsWorker(page);
  await expect(page.getByText('Наряды').first()).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => langs.some((h) => h === 'ru'), { timeout: 20000 }).toBe(true);
  await page.getByLabel(/language/i).selectOption('kk');
  await expect(page.getByText('Нарядтар').first()).toBeVisible({ timeout: 15000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Нарядтар').first()).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => langs.some((h) => h === 'kk'), { timeout: 20000 }).toBe(true);
});
