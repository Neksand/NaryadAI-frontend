import { randomUUID } from 'crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { requireLiveApi } from './live-api';

test.setTimeout(60_000);

// Live: кнопки карточки мастера строго из backend allowed_actions, против
// реального API http://127.0.0.1:8080/api/v1 (через vite dev-server /api proxy).
// No page.route mocks.
// CI-guard copied from e2e/manager-areas.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.

async function gotoLogin(page: Page) {
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

async function loginAsMaster(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('master1');
  await inputs.nth(1).fill('3333');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/master/, { timeout: 20000 });
}

async function apiToken(request: APIRequestContext): Promise<string> {
  await requireLiveApi(request);
  const res = await request.post('/api/v1/auth/login', { data: { login: 'master1', pin: '3333' } });
  expect(res.status()).toBe(200);
  return (await res.json()).access_token as string;
}

async function apiGet(request: APIRequestContext, token: string, path: string): Promise<unknown> {
  const res = await request.get(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  return res.json();
}

function itemsOf(body: unknown): { id: string; login?: string }[] {
  if (Array.isArray(body)) return body;
  const o = (body ?? {}) as Record<string, unknown>;
  if (Array.isArray(o.items)) return o.items as { id: string; login?: string }[];
  if (Array.isArray(o.data)) return o.data as { id: string; login?: string }[];
  return [];
}

// Свой issued-наряд: у мастера живьём allowed_actions вида
// [reassign, cancel, change_priority] — кнопки рендерятся только из них.
async function createMasterOrder(
  request: APIRequestContext,
  description: string,
): Promise<{ id: string; allowed: string[]; workerId: string }> {
  const token = await apiToken(request);
  const sites = itemsOf(await apiGet(request, token, '/sites'));
  expect(sites.length).toBeGreaterThan(0);
  let equipmentId = '';
  for (const s of sites) {
    const eq = itemsOf(await apiGet(request, token, `/equipment?area_id=${s.id}`));
    if (eq.length > 0) {
      equipmentId = eq[0].id;
      break;
    }
  }
  expect(equipmentId).toBeTruthy();
  const workers = itemsOf(await apiGet(request, token, '/workers'));
  const w01 = workers.find((w) => w.login === 'worker01');
  expect(w01?.id).toBeTruthy();
  const res = await request.post('/api/v1/work-orders', {
    data: {
      kind: 'planned',
      description,
      equipment_id: equipmentId,
      assignee_id: w01!.id,
      priority: 'normal',
      due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
      norm_minutes: 60,
    },
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
  });
  expect([200, 201]).toContain(res.status());
  const created = (await res.json()) as { id: string };
  const order = (await apiGet(request, token, `/work-orders/${created.id}`)) as {
    allowed_actions?: string[];
  };
  return { id: created.id, allowed: order.allowed_actions ?? [], workerId: w01!.id };
}

const ACTION_LABEL: Record<string, string> = {
  reassign: 'Переназначить',
  cancel: 'Отменить',
  change_priority: 'Сменить приоритет',
};

test('live: master order shows buttons only from live allowed_actions', async ({
  page,
  request,
}) => {
  const description = `e2e-${Date.now()} action-clarity`;
  const { id, allowed } = await createMasterOrder(request, description);
  expect(allowed.length).toBeGreaterThan(0);

  await loginAsMaster(page);
  await page.goto(`/master/orders/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(description).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Действия:/)).toBeVisible({ timeout: 20000 });
  // Проверяем только те действия, что реально разрешил бэкенд.
  for (const a of allowed) {
    const label = ACTION_LABEL[a];
    if (label)
      await expect(page.getByRole('button', { name: label })).toBeVisible({ timeout: 20000 });
  }
});

test('live: reassign requires an explicit assignee before sending', async ({ page, request }) => {
  const description = `e2e-${Date.now()} reassign-guard`;
  const { id, allowed, workerId } = await createMasterOrder(request, description);
  test.skip(!allowed.includes('reassign'), 'live order has no reassign action');

  await loginAsMaster(page);
  await page.goto(`/master/orders/${id}`, { waitUntil: 'domcontentloaded' });
  const reassign = page.getByRole('button', { name: 'Переназначить' });
  await expect(reassign).toBeVisible({ timeout: 20000 });
  await expect(reassign).toBeDisabled();
  // Переназначаем тому же worker01 живым uuid — состояние стенда не страдает.
  await page.getByLabel('Исполнитель').fill(workerId);
  await expect(reassign).toBeEnabled();
  const requestPromise = page.waitForRequest(
    (r) => r.url().includes(`/work-orders/${id}/transitions`) && r.method() === 'POST',
    { timeout: 20000 },
  );
  await reassign.click();
  const sent = await requestPromise;
  expect(sent.postDataJSON().action).toBe('reassign');
});

test('live: unavailable action is absent from a closed order view', async ({ page, request }) => {
  const token = await apiToken(request);
  const closed = itemsOf(await apiGet(request, token, '/work-orders?status=closed&limit=5'));
  test.skip(closed.length === 0, 'no live closed orders');
  const id = closed[0].id;

  await loginAsMaster(page);
  await page.goto(`/master/orders/${id}`, { waitUntil: 'domcontentloaded' });
  // У закрытого наряда пустые allowed_actions: рабочих кнопок быть не должно.
  await expect(page.getByRole('button', { name: 'Переназначить' })).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(page.getByRole('button', { name: 'Сменить приоритет' })).toHaveCount(0);
});
