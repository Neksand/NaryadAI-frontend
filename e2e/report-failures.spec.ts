import { expect, test, type Page } from '@playwright/test';

// Fully live against the real API http://127.0.0.1:8080 (via vite dev-server /api proxy).
// No page.route at all: POST counting via passive response listeners.
// Backend 422-validation is covered by backend pytest (test_analytics_api / reports);
// UI cannot assemble an invalid payload (type select limited, from>to disabled).
//
// CI-guard copied from e2e/live-smoke.spec.ts (needs the dev-server origin for fetch):
// without a live API the specs skip (CI has no stand), locally with the stand up
// they run for real.

async function gotoLogin(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('naryadai.lang', 'ru');
  });
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.removeItem('naryadai.refresh');
    localStorage.removeItem('naryadai.cached-user.v1');
  });
  await page.reload();
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

async function loginAsManager(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('manager1');
  await inputs.nth(1).fill('2222');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/manager/, { timeout: 20000 });
  const panel = page.getByRole('region', { name: 'Выгрузка отчёта' });
  await expect(panel.getByRole('heading', { name: 'Выгрузка отчёта' })).toBeVisible({
    timeout: 20000,
  });
  return panel;
}

test('live: default orders/xlsx export completes with a download link', async ({ page }) => {
  const panel = await loginAsManager(page);
  const posts: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/reports/export') && r.request().method() === 'POST' && r.ok()) posts.push(r.status());
  });
  await panel.getByRole('button', { name: 'Подготовить отчёт' }).click();
  await expect(panel.getByRole('link', { name: 'Скачать отчёт' })).toBeVisible({ timeout: 90000 });
  expect(posts.length).toBeGreaterThanOrEqual(1);
});

test('live: retrying export creates a second live job', async ({ page }) => {
  const panel = await loginAsManager(page);
  let postCalls = 0;
  page.on('response', (r) => {
    if (r.url().includes('/reports/export') && r.request().method() === 'POST' && r.ok()) postCalls += 1;
  });
  const create = panel.getByRole('button', { name: 'Подготовить отчёт' });
  await expect(create).toBeVisible({ timeout: 20000 });
  await create.click();
  await expect(panel.getByRole('link', { name: 'Скачать отчёт' })).toBeVisible({ timeout: 90000 });
  await create.click();
  await expect.poll(() => postCalls, { timeout: 90000 }).toBeGreaterThanOrEqual(2);
});
