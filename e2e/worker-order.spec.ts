import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

// Live-версия против реального API http://127.0.0.1:8080 (через vite /api proxy).
// Seed: worker01/1001 с реальными нарядами. Без живого стенда — скип (CI-guard ниже).

async function gotoLogin(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-worker-order-cleaned')) return;
    sessionStorage.setItem('e2e-worker-order-cleaned', '1');
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
  // Own issued order makes this mutation independent of seed ordering and earlier runs.
  const masterLogin = await page.request.post('/api/v1/auth/login', {
    data: { login: 'master1', pin: '3333' },
  });
  expect(masterLogin.status()).toBe(200);
  const masterHeaders = { Authorization: `Bearer ${(await masterLogin.json()).access_token}` };
  const workerLogin = await page.request.post('/api/v1/auth/login', {
    data: { login: 'worker01', pin: '1001' },
  });
  expect(workerLogin.status()).toBe(200);
  const workerHeaders = { Authorization: `Bearer ${(await workerLogin.json()).access_token}` };
  const meResponse = await page.request.get('/api/v1/me', { headers: workerHeaders });
  expect(meResponse.status()).toBe(200);
  const me = await meResponse.json();
  const equipmentResponse = await page.request.get(`/api/v1/equipment?area_id=${me.area_ids[0]}`, {
    headers: masterHeaders,
  });
  expect(equipmentResponse.status()).toBe(200);
  const body = await equipmentResponse.json();
  const equipmentId = (Array.isArray(body) ? body : (body.items ?? body.data))[0]?.id;
  expect(equipmentId).toBeTruthy();
  const created = await page.request.post('/api/v1/work-orders', {
    headers: { ...masterHeaders, 'Idempotency-Key': randomUUID() },
    data: {
      kind: 'unplanned',
      description: `e2e-isolated-action-${randomUUID()}`,
      equipment_id: equipmentId,
      assignee_id: me.id,
      priority: 'high',
      due_at: new Date(Date.now() + 3600000).toISOString(),
      norm_minutes: 60,
      equipment_stopped: false,
    },
  });
  expect(created.status()).toBe(201);
  const orderId = (await created.json()).id;
  try {
    await page.goto(`/worker/orders/${orderId}`);
    const accept = page.getByRole('button', { name: 'Принять в работу', exact: true });
    await expect(accept).toBeVisible({ timeout: 20000 });
    const posted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/work-orders/${orderId}/transitions`) &&
        response.request().method() === 'POST',
    );
    await accept.click();
    expect((await posted).status()).toBe(200);
    await expect(page.getByText('Принят', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeEnabled();
    const saved = await page.request.get(`/api/v1/work-orders/${orderId}`, {
      headers: workerHeaders,
    });
    expect((await saved.json()).status).toBe('accepted');
  } finally {
    const cleanup = await page.request.post(`/api/v1/work-orders/${orderId}/transitions`, {
      headers: masterHeaders,
      data: { action: 'cancel', reason_code: 'duplicate', client_at: new Date().toISOString() },
    });
    expect(cleanup.status()).toBe(200);
  }
});
