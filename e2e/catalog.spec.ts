import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: /admin catalogs against the real API http://127.0.0.1:8080/api/v1
// (through the vite dev-server /api proxy). No page.route mocks.
// CI-guard copied from e2e/live-smoke.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.

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

async function loginAsAdmin(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('1234');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20000 });
}

async function expectRowsNonEmpty(page: Page) {
  await expect(async () => {
    const n = await page.locator('table.tbl tbody tr').count();
    expect(n).toBeGreaterThan(0);
  }).toPass({ timeout: 20000 });
}

test('live: admin catalog tabs switch and lists are non-empty', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tablist', { name: 'Админ' })).toBeVisible({ timeout: 20000 });
  // Сид стенда: 25 equipment, 20 fault-codes.
  await page.getByRole('button', { name: 'Оборудование' }).click();
  await expectRowsNonEmpty(page);
  await page.getByRole('button', { name: 'Шифры' }).click();
  await expectRowsNonEmpty(page);
  await page.getByRole('button', { name: 'Участки' }).click();
  await expectRowsNonEmpty(page);
});

test('live: admin tab survives reload (page recovers, tab reselectable)', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tablist', { name: 'Админ' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Оборудование' }).click();
  await expectRowsNonEmpty(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  // NOTE: AdminPage хранит выбранный таб только в useState (без ?tab= в URL),
  // поэтому после reload активен таб по умолчанию. Проверяем толерантно:
  // страница восстанавливается, а таб снова выбирается и показывает живые данные.
  await expect(page.getByRole('tablist', { name: 'Админ' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Оборудование' }).click();
  await expectRowsNonEmpty(page);
});
