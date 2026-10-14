import { expect, test, type Page } from '@playwright/test';

// Live-версия против реального API http://127.0.0.1:8080 (через vite /api proxy).
// Данные живые: проверяем равенство счётчик==карточки, а не конкретные числа.

async function gotoLogin(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('naryadai.refresh');
    localStorage.removeItem('naryadai.cached-user.v1');
    localStorage.setItem('naryadai.lang', 'ru');
  });
  await page.goto('/login');
  // Живой API за vite-прокси: любой HTTP-ответ от /api/v1/* (включая 401) = стенд поднят.
  const live = await page
    .evaluate(async () => {
      try {
        await fetch('/api/v1/me', { method: 'GET' });
        return true;
      } catch {
        return false;
      }
    })
    .catch(() => false);
  test.skip(!live, 'no live API stand — run backend e2e_stand + uvicorn first');
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible({ timeout: 15000 });
}

async function fillLoginForm(page: Page, login: string, pin: string) {
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(login);
  await inputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
}

async function loginAsWorker(page: Page) {
  await gotoLogin(page);
  await fillLoginForm(page, 'worker01', '1001');
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
}

async function tabCounter(page: Page, name: RegExp): Promise<number> {
  const text = (await page.getByRole('tab', { name }).textContent()) ?? '';
  const m = text.match(/\((\d+)\)/);
  if (!m) throw new Error(`no counter in tab label: ${text}`);
  return Number(m[1]);
}

// Счётчик читаем только после загрузки данных, а равенство проверяем предикатом,
// который перечитывает И счётчик, И карточки каждый полл (живые данные меняются).
async function expectTabMatchesCards(page: Page, name: RegExp) {
  const tab = page.getByRole('tab', { name });
  await expect(tab).toBeVisible({ timeout: 20000 });
  await tab.click();
  await expect
    .poll(
      async () => {
        const label = (await tab.textContent()) ?? '';
        const m = label.match(/\((\d+)\)/);
        const cards = await page.locator('article').count();
        return m ? Number(m[1]) === cards : false;
      },
      { timeout: 20000 },
    )
    .toBe(true);
}

test('live: all-tab counter equals visible cards', async ({ page }) => {
  await loginAsWorker(page);
  // Seed гарантирует непустые активные — ждём загрузки, иначе счётчик прочитается как (0).
  await expect(page.locator('article').first()).toBeVisible({ timeout: 20000 });
  const expected = await tabCounter(page, /Сейчас в работе/);
  await expect.poll(async () => page.locator('article').count(), { timeout: 20000 }).toBe(expected);
});

test('live: urgent-tab counter equals visible cards', async ({ page }) => {
  await loginAsWorker(page);
  await expect(page.locator('article').first()).toBeVisible({ timeout: 20000 });
  await expectTabMatchesCards(page, /Срочные/);
});

test('live: queue-tab counter equals visible cards', async ({ page }) => {
  await loginAsWorker(page);
  await expect(page.locator('article').first()).toBeVisible({ timeout: 20000 });
  await expectTabMatchesCards(page, /Очередь/);
});
