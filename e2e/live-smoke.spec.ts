import { expect, test, type Page } from '@playwright/test';

// Live smoke against the real API http://127.0.0.1:8080/api/v1
// (reached through the vite dev-server /api proxy). No page.route mocks.
//
// Stand:  scripts/e2e_stand.py  +  uvicorn app.main:app --port 8080 (backend repo).
// Seed accounts: master1/3333, worker01/1001.
//
// CI-guard живёт внутри gotoLogin (нужен origin dev-сервера для fetch):
// без живого API спеки скипаются (в CI живого стенда нет),
// локально с поднятым стендом — выполняются по-настоящему.

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

test('live: master1/3333 login -> 200 + redirect to /master', async ({ page }) => {
  await gotoLogin(page);
  await fillLoginForm(page, 'master1', '3333');
  await expect(page).toHaveURL(/\/master/, { timeout: 20000 });
});

test('live: worker01/1001 login -> own work orders visible', async ({ page }) => {
  await gotoLogin(page);
  await fillLoginForm(page, 'worker01', '1001');
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
  // Seeded worker01 always owns active + history orders; cards link to order pages.
  await expect(page.locator('a[href*="/worker/orders/"]').first()).toBeVisible({ timeout: 20000 });
});

test('live: wrong PIN -> inline error, no crash', async ({ page }) => {
  // Несуществующий логин — не жжём счётчик попыток seeded-аккаунтов.
  await gotoLogin(page);
  await fillLoginForm(page, 'nouser-live', '9999');
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/\/login/);
});
