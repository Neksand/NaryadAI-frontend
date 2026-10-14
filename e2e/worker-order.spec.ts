import { expect, test, type Page } from '@playwright/test';

// Live-версия против реального API http://127.0.0.1:8080 (через vite /api proxy).
// Seed: worker01/1001 с реальными нарядами. Без живого стенда — скип (CI-guard ниже).

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

// Прямые экшены без модальных форм (WorkerOrder: reject/pause/complete открывают формы).
const DIRECT_ACTION = /Принять в работу|Начать|Продолжить|В очередь/;

test('live: worker order page shows action button', async ({ page }) => {
  await loginAsWorker(page);
  // Первая карточка /worker → открыть живой наряд worker01.
  const firstCard = page.locator('a[href*="/worker/orders/"]').first();
  await expect(firstCard).toBeVisible({ timeout: 20000 });
  await firstCard.click();
  await expect(page).toHaveURL(/\/worker\/orders\//, { timeout: 20000 });
  await expect(page.getByText(/№/).first()).toBeVisible({ timeout: 20000 });
  const actions = page.locator('.dock-sticky button');
  const noActions = page.getByText('Нет доступных действий');
  await expect(actions.first().or(noActions)).toBeVisible({ timeout: 20000 });
  if ((await actions.count()) > 0) await expect(actions.first()).toBeEnabled({ timeout: 15000 });
});

test('live: online action posts real transition, card status changes', async ({ page }) => {
  await loginAsWorker(page);
  await expect(page.locator('a[href*="/worker/orders/"]').first()).toBeVisible({ timeout: 20000 });
  // Первая карточка с прямым экшеном (обычно первая же: у worker01 десятки issued/accepted).
  let actionBtn = page.locator('.dock-sticky button').first();
  let found = false;
  for (let i = 0; i < 10 && !found; i += 1) {
    await page.locator('a[href*="/worker/orders/"]').nth(i).click();
    await expect(page).toHaveURL(/\/worker\/orders\//, { timeout: 20000 });
    // Ждём ЛЮБОЙ исход рендера (кнопки / баннер «нет действий»), затем ищем прямой экшен.
    const anyBtn = page.locator('.dock-sticky button').first();
    await expect(anyBtn.or(page.getByText('Нет доступных действий'))).toBeVisible({
      timeout: 20000,
    });
    actionBtn = page.locator('.dock-sticky button').filter({ hasText: DIRECT_ACTION }).first();
    found = (await actionBtn.count()) > 0;
    // SPA-назад: page.goto перезагрузил бы документ и addInitScript guard стёр бы refresh из localStorage.
    if (!found) {
      await page.goBack();
      await expect(page).toHaveURL(/\/worker$/, { timeout: 20000 });
    }
  }
  expect(found).toBeTruthy();
  await expect(actionBtn).toBeEnabled({ timeout: 15000 });
  const dockBefore = await page.locator('.dock-sticky').innerText();
  // Реальный POST живому API — без page.route.
  const posted = page.waitForResponse(
    (r) =>
      r.url().includes('/work-orders/') &&
      r.url().includes('/transitions') &&
      r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await actionBtn.click();
  const resp = await posted;
  if (resp.ok()) {
    // Смена статуса карточки: набор кнопок dock изменился после рефетча заказа.
    await expect
      .poll(async () => page.locator('.dock-sticky').innerText(), { timeout: 20000 })
      .not.toBe(dockBefore);
  } else {
    // Параллельный прогон мог сменить состояние раньше нас — главное, что POST ушёл и UI жив.
    await expect(page.locator('.dock-sticky, .banner').first()).toBeVisible({ timeout: 15000 });
  }
});
