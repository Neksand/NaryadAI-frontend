import { expect, test, type Page } from '@playwright/test';

// Live-версия против реального API http://127.0.0.1:8080 (через vite /api proxy).
// Офлайн-очередь + реальный реплей живому стенду. Без стенда — скип (CI-guard ниже).

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

// Быстрые кнопки карточек (WorkerOrderCard: только accept/queue/start/resume — остальные ведут на страницу).
const QUICK_ACTION = /Принять в работу|Начать|Продолжить|В очередь/;

async function queueOneActionOffline(page: Page) {
  await loginAsWorker(page);
  const action = page.getByRole('button', { name: QUICK_ACTION }).first();
  await expect(action).toBeVisible({ timeout: 20000 });
  await page.context().setOffline(true);
  await expect(page.getByText('Нет связи')).toBeVisible({ timeout: 20000 });
  await action.click();
  await expect(page.getByText('В очереди действий: 1')).toBeVisible({ timeout: 20000 });
}

test('live: offline action queued, online replay sends it (success or 409)', async ({ page }) => {
  await queueOneActionOffline(page);
  await page.context().setOffline(false);
  // Страховка: если auto-replay по online-событию не стартовал — жмём «Повторить».
  await page.waitForTimeout(1500);
  const retry = page.getByRole('button', { name: 'Повторить' }).first();
  if (
    (await page.getByText('В очереди действий').count()) > 0 &&
    (await page.getByRole('alert').count()) === 0 &&
    (await retry.count()) > 0 &&
    (await retry.isEnabled().catch(() => false))
  ) {
    await retry.click();
  }
  // Живое серверное состояние меняется между прогонами: реплей либо проходит
  // (очередь пуста), либо падает 409-конфликтом (alert) — принимаем ОБА исхода.
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes('В очереди действий') ||
      document.querySelector('[role="alert"]') !== null,
    undefined,
    { timeout: 20000 },
  );
  if ((await page.getByRole('alert').count()) > 0) {
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 15000 });
  } else {
    await expect(page.getByText('В очереди действий')).toHaveCount(0, { timeout: 15000 });
  }
  await page.context().setOffline(false);
});

test('live: delete button removes queued action', async ({ page }) => {
  await queueOneActionOffline(page);
  await page.getByRole('button', { name: 'Удалить' }).first().click();
  await expect(page.getByText('В очереди действий')).toHaveCount(0, { timeout: 15000 });
  await page.context().setOffline(false);
});
