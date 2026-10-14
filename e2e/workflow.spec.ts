import { randomUUID } from 'crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { requireLiveApi } from './live-api';

test.setTimeout(60_000);

// Live: полный цикл accept→start→complete своим нарядом против реального API
// http://127.0.0.1:8080/api/v1 (через vite dev-server /api proxy).
// No page.route mocks. Чистить не надо: closed-история безвредна.
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

async function loginAs(page: Page, login: string, pin: string, urlRe: RegExp) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(login);
  await inputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(urlRe, { timeout: 20000 });
}

async function apiToken(request: APIRequestContext, login: string, pin: string): Promise<string> {
  await requireLiveApi(request);
  const res = await request.post('/api/v1/auth/login', { data: { login, pin } });
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

async function apiPost(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  ok = [200, 201, 202],
): Promise<unknown> {
  const res = await request.post(`/api/v1${path}`, {
    data,
    headers: {
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': randomUUID(),
    },
  });
  expect(ok).toContain(res.status());
  return res.json();
}

function itemsOf(body: unknown): { id: string; login?: string }[] {
  if (Array.isArray(body)) return body;
  const o = (body ?? {}) as Record<string, unknown>;
  if (Array.isArray(o.items)) return o.items as { id: string; login?: string }[];
  if (Array.isArray(o.data)) return o.data as { id: string; login?: string }[];
  return [];
}

interface Seed {
  masterToken: string;
  workerToken: string;
  equipmentId: string;
  workerId: string;
  faultCodeId: string;
}

async function liveSeed(request: APIRequestContext): Promise<Seed> {
  const masterToken = await apiToken(request, 'master1', '3333');
  const workerToken = await apiToken(request, 'worker01', '1001');
  const sites = itemsOf(await apiGet(request, masterToken, '/sites'));
  expect(sites.length).toBeGreaterThan(0);
  let equipmentId = '';
  for (const s of sites) {
    const eq = itemsOf(await apiGet(request, masterToken, `/equipment?area_id=${s.id}`));
    if (eq.length > 0) {
      equipmentId = eq[0].id;
      break;
    }
  }
  expect(equipmentId).toBeTruthy();
  const workers = itemsOf(await apiGet(request, masterToken, '/workers'));
  const w01 = workers.find((w) => w.login === 'worker01');
  expect(w01?.id).toBeTruthy();
  const faultCodes = itemsOf(await apiGet(request, masterToken, '/fault-codes'));
  expect(faultCodes.length).toBeGreaterThan(0);
  return {
    masterToken,
    workerToken,
    equipmentId,
    workerId: w01!.id,
    faultCodeId: faultCodes[0].id,
  };
}

// Свой planned-наряд мастером: complete planned живьём — без фото.
async function createOwnOrder(
  request: APIRequestContext,
  seed: Seed,
  description: string,
): Promise<string> {
  const created = (await apiPost(
    request,
    seed.masterToken,
    '/work-orders',
    {
      kind: 'planned',
      description,
      equipment_id: seed.equipmentId,
      assignee_id: seed.workerId,
      priority: 'normal',
      due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
      norm_minutes: 60,
    },
    [200, 201],
  )) as { id: string };
  expect(created.id).toBeTruthy();
  return created.id;
}

async function transitionAs(
  request: APIRequestContext,
  token: string,
  orderId: string,
  action: string,
  extra: Record<string, unknown> = {},
) {
  return apiPost(request, token, `/work-orders/${orderId}/transitions`, {
    action,
    client_at: new Date().toISOString(),
    ...extra,
  });
}

function waitTransition(page: Page, orderId: string) {
  return page.waitForResponse(
    (r) =>
      r.url().includes(`/work-orders/${orderId}/transitions`) && r.request().method() === 'POST',
    { timeout: 20000 },
  );
}

test('live: worker runs accept then start on a fresh order', async ({ page, request }) => {
  const seed = await liveSeed(request);
  const description = `e2e-${Date.now()} accept-start`;
  const orderId = await createOwnOrder(request, seed, description);

  await loginAs(page, 'worker01', '1001', /\/worker/);
  await page.goto(`/worker/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(description)).toBeVisible({ timeout: 20000 });

  const accept = page.getByRole('button', { name: 'Принять в работу' });
  await expect(accept).toBeVisible({ timeout: 20000 });
  const acceptPosted = waitTransition(page, orderId);
  await accept.click();
  await acceptPosted;
  const start = page.getByRole('button', { name: 'Начать' });
  await expect(start).toBeVisible({ timeout: 20000 });
  const startPosted = waitTransition(page, orderId);
  await start.click();
  await startPosted;
  await expect(page.getByRole('button', { name: 'Завершить' })).toBeVisible({ timeout: 20000 });
});

test('live: worker completes an in-progress order with a work report', async ({
  page,
  request,
}) => {
  const seed = await liveSeed(request);
  const description = `e2e-${Date.now()} complete-report`;
  const orderId = await createOwnOrder(request, seed, description);
  await transitionAs(request, seed.workerToken, orderId, 'accept');
  await transitionAs(request, seed.workerToken, orderId, 'start');

  await loginAs(page, 'worker01', '1001', /\/worker/);
  await page.goto(`/worker/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
  const completeButtons = page.getByRole('button', { name: 'Завершить' });
  await expect(completeButtons.first()).toBeVisible({ timeout: 20000 });
  await completeButtons.first().click();
  const dialog = page.getByRole('dialog', { name: 'Завершение наряда' });
  await expect(dialog).toBeVisible({ timeout: 20000 });
  // Живой шифт неисправности — uuid из справочника сервера (не мок 'fc-1').
  await dialog.locator('textarea').fill('e2e заменил подшипник и проверил люфт');
  await dialog.getByLabel(/Шифр неисправности/).selectOption(seed.faultCodeId);
  const submitted = waitTransition(page, orderId);
  await completeButtons.last().click();
  await submitted;
  // complete planned → ai_review: толерантно к живому статусу.
  await expect(page.getByText(/Исполнено|Проверка ИИ/).first()).toBeVisible({ timeout: 20000 });
});

test('live: stale accept after server-side cancel shows an error', async ({ page, request }) => {
  const seed = await liveSeed(request);
  const description = `e2e-${Date.now()} stale-409`;
  const orderId = await createOwnOrder(request, seed, description);

  await loginAs(page, 'worker01', '1001', /\/worker/);
  await page.goto(`/worker/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
  const accept = page.getByRole('button', { name: 'Принять в работу' });
  await expect(accept).toBeVisible({ timeout: 20000 });
  // Серверное состояние ушло вперёд: мастер отменил наряд (cancel живьём
  // требует reason_code из справочника) — accept теперь 409.
  const cancelReasons = await request.get('/api/v1/dict/reasons?kind=cancel', {
    headers: { Authorization: `Bearer ${seed.masterToken}` },
  });
  expect(cancelReasons.status()).toBe(200);
  const reasonItems = ((await cancelReasons.json()) as { items?: { code?: string }[] }).items ?? [];
  expect(reasonItems.length).toBeGreaterThan(0);
  await transitionAs(request, seed.masterToken, orderId, 'cancel', {
    reason_code: reasonItems[0].code,
  });
  const rejected = waitTransition(page, orderId);
  await accept.click();
  await rejected;
  await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 20000 });
});
