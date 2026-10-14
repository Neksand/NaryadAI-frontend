import { randomUUID } from 'crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: действия worker с причинами из живого справочника /dict/reasons
// против реального API http://127.0.0.1:8080/api/v1 (через vite dev-server
// /api proxy). No page.route mocks. Каждый тест создаёт СВОЙ наряд мастером
// (уникальное описание e2e-<ts>), reject/pause/queue его потребляют.
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

async function loginAsWorker(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('worker01');
  await inputs.nth(1).fill('1001');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
}

async function apiToken(request: APIRequestContext, login: string, pin: string): Promise<string> {
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

function itemsOf(body: unknown): { id: string; login?: string; code?: string }[] {
  if (Array.isArray(body)) return body;
  const o = (body ?? {}) as Record<string, unknown>;
  if (Array.isArray(o.items)) return o.items as { id: string; login?: string; code?: string }[];
  if (Array.isArray(o.data)) return o.data as { id: string; login?: string; code?: string }[];
  return [];
}

interface Seed {
  masterToken: string;
  workerToken: string;
  equipmentId: string;
  workerId: string;
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
  return { masterToken, workerToken, equipmentId, workerId: w01!.id };
}

async function createOwnOrder(
  request: APIRequestContext,
  seed: Seed,
  description: string,
): Promise<string> {
  const res = await request.post('/api/v1/work-orders', {
    data: {
      kind: 'planned',
      description,
      equipment_id: seed.equipmentId,
      assignee_id: seed.workerId,
      priority: 'normal',
      due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
      norm_minutes: 60,
    },
    headers: { Authorization: `Bearer ${seed.masterToken}`, 'Idempotency-Key': randomUUID() },
  });
  expect([200, 201]).toContain(res.status());
  return ((await res.json()) as { id: string }).id;
}

async function transitionAs(
  request: APIRequestContext,
  token: string,
  orderId: string,
  action: string,
  extra: Record<string, unknown> = {},
) {
  const res = await request.post(`/api/v1/work-orders/${orderId}/transitions`, {
    data: { action, client_at: new Date().toISOString(), ...extra },
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
  });
  expect([200, 201]).toContain(res.status());
  return res.json();
}

// Живой код причины из справочника сервера (фронт шлёт англ. code).
async function reasonCode(
  request: APIRequestContext,
  token: string,
  kind: string,
): Promise<string> {
  const codes = itemsOf(await apiGet(request, token, `/dict/reasons?kind=${kind}`));
  expect(codes.length).toBeGreaterThan(0);
  return codes[0].code as string;
}

function waitTransition(page: Page, orderId: string) {
  return page.waitForResponse(
    (r) =>
      r.url().includes(`/work-orders/${orderId}/transitions`) && r.request().method() === 'POST',
    { timeout: 20000 },
  );
}

test('live: worker reject sends reason_code from live dict', async ({ page, request }) => {
  const seed = await liveSeed(request);
  const description = `e2e-${Date.now()} reject-reason`;
  const orderId = await createOwnOrder(request, seed, description);
  const code = await reasonCode(request, seed.workerToken, 'reject');

  await loginAsWorker(page);
  await page.goto(`/worker/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(description)).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Отклонить' }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20000 });
  await page.getByLabel('Выберите причину из справочника').selectOption(code);
  const saved = waitTransition(page, orderId);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await saved;
  await expect(page.getByText(/Отклонён/).first()).toBeVisible({ timeout: 20000 });
});

test('live: worker pause sends reason_code from live dict', async ({ page, request }) => {
  const seed = await liveSeed(request);
  const description = `e2e-${Date.now()} pause-reason`;
  const orderId = await createOwnOrder(request, seed, description);
  // Пауза доступна из in_progress: доводим наряд живыми переходами.
  await transitionAs(request, seed.workerToken, orderId, 'accept');
  await transitionAs(request, seed.workerToken, orderId, 'start');
  const code = await reasonCode(request, seed.workerToken, 'pause');

  await loginAsWorker(page);
  await page.goto(`/worker/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(description)).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20000 });
  await page.getByLabel('Выберите причину из справочника').selectOption(code);
  const saved = waitTransition(page, orderId);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await saved;
  await expect(page.getByText(/Приостановлен/).first()).toBeVisible({ timeout: 20000 });
});

test('live: worker put-in-queue posts transition without reason dialog', async ({
  page,
  request,
}) => {
  const seed = await liveSeed(request);
  const description = `e2e-${Date.now()} queue-direct`;
  const orderId = await createOwnOrder(request, seed, description);

  await loginAsWorker(page);
  await page.goto(`/worker/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(description)).toBeVisible({ timeout: 20000 });

  const queued = waitTransition(page, orderId);
  await page.getByRole('button', { name: 'В очередь' }).click();
  await queued;
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/В очереди/).first()).toBeVisible({ timeout: 20000 });
});
