import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: /admin layout against the real API http://127.0.0.1:8080/api/v1
// (through the vite dev-server /api proxy). No page.route mocks.
// CI-guard copied from e2e/manager-areas.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.
// Мутаций нет — только переключение табов и проверка вёрстки.

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

async function loginAsAdmin(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('1234');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20000 });
}

test('live: admin dict tabs keep bedding on desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsAdmin(page);
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tablist', { name: 'Админ' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Участки' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Оборудование' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Сотрудники' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Нормы' })).toBeVisible({ timeout: 15000 });
});

test('live: admin employee form holds layout on narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tablist', { name: 'Админ' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Сотрудники' }).click();
  await expect(page.getByText('Новый сотрудник')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Создать +' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('tablist', { name: 'Админ' })).toBeVisible({ timeout: 15000 });
});

test('live: admin create forms do not break across dict tabs', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tablist', { name: 'Админ' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Оборудование' }).click();
  await expect(page.getByRole('button', { name: 'Создать +' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Причины' }).click();
  await expect(page.getByRole('button', { name: 'Создать +' })).toBeVisible({ timeout: 20000 });
});
