import { expect, test, type Page } from '@playwright/test';

// Live against the real API http://127.0.0.1:8080 (via vite dev-server /api proxy).
// No page.route mocks.
//
// КРИТИЧНО: негативные тесты бьют ТОЛЬКО по несуществующим логинам
// (уникальный суффикс на прогон). Seeded-аккаунты (worker01, master1, …) неверными
// PIN бы не трогаем — иначе стенд их заблокирует на 423 для всех остальных тестов.
// Проверено: неизвестный логин всегда отвечает 401 и никогда не лочится.
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

async function fillCreds(page: Page, login: string, pin: string) {
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(login);
  await inputs.nth(1).fill(pin);
}

test('live: wrong PIN on unknown login shows error without leaving login', async ({ page }) => {
  await gotoLogin(page);
  await fillCreds(page, `nouser-live-${Date.now()}`, '9999');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toContainText('Неверный логин или PIN', { timeout: 20000 });
  await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
});

test('live: repeated wrong attempts on unknown login stay on /login, no crash', async ({
  page,
}) => {
  // Тот же сценарий, что «5 неверных → 423», но на несуществующем логине:
  // стенд такие аккаунты не лочит (всегда 401), seeded-аккаунты в безопасности.
  // Проверяем, что форма переживает серию ошибок и остаётся на /login.
  await gotoLogin(page);
  await fillCreds(page, `nouser-lock-${Date.now()}`, '9999');
  const submit = page.getByRole('button', { name: 'Войти' });
  await expect(submit).toBeEnabled({ timeout: 15000 });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText(/Неверный логин или PIN|заблокирован/, {
    timeout: 20000,
  });
  for (let i = 0; i < 4; i += 1) {
    await expect(submit).toBeEnabled({ timeout: 15000 });
    await submit.click();
  }
  await expect(page.getByRole('alert')).toContainText(/Неверный логин или PIN|заблокирован/, {
    timeout: 20000,
  });
  await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
});

test('live: successful login leads to role home', async ({ page }) => {
  await gotoLogin(page);
  await fillCreds(page, 'worker01', '1001');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
  await expect(page.getByText('Наряды').first()).toBeVisible({ timeout: 15000 });
});
