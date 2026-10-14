import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: приватность фото против живого API http://127.0.0.1:8080/api/v1
// (через vite dev-server /api proxy). No page.route mocks.
// CI-guard copied from e2e/manager-areas.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.
//
// Приватность фото: бэкенд отдаёт приватные оригиналы только через
// signed URL (GET /photos/:id/url с expires_in), чужие фото — 404.
// photoUrl() нигде не рендерит <img> напрямую — контракт проверяем живым
// fetch в контексте страницы (Bearer приложения через снифф исходящих
// запросов — без ротации refresh и убийства UI-сессии) + видимое
// UI-состояние, без скриншотов.
// МУТАЦИИ — только строго изолированные: свой наряд с уникальным описанием
// e2e-privacy-* (master1 через API → worker01), доводим accept/start через API
// отдельным worker-логином, after-фото грузим без submit завершения, затем
// отменяем наряд (transitions cancel + reason_code) в afterEach.
// Чужие/сид-наряды не трогаем.

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

/**
 * Отдельный API-токен через прямой логин ( НЕ трогает UI-сессию и localStorage:
 * access-токены разных логинов живут параллельно, refresh не дёргаем —
 * ротации и разлогина UI нет, проверено живьём).
 */
async function apiTokenFor(page: Page, login: string, pin: string): Promise<string | null> {
  return await page.evaluate(
    async ([l, p]) => {
      try {
        const r = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: l, pin: p }),
        });
        if (!r.ok) return null;
        return ((await r.json()).access_token ?? null) as string | null;
      } catch {
        return null;
      }
    },
    [login, pin] as [string, string],
  );
}

async function apiGet(page: Page, path: string, token: string) {
  return await page.evaluate(
    async ([p, at]) => {
      try {
        const res = await fetch(`/api/v1${p}`, { headers: { Authorization: `Bearer ${at}` } });
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          /* empty */
        }
        return { status: res.status, json };
      } catch {
        return null;
      }
    },
    [path, token] as [string, string],
  );
}

/** Маленький валидный JPEG через canvas + подкладка в первый file-input. */
async function attachJpeg(page: Page, fileName: string) {
  await page.evaluate(async (fname) => {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no-2d-context');
    ctx.fillStyle = '#8aa8c8';
    ctx.fillRect(0, 0, 48, 48);
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(8, 8, 32, 32);
    const blob = await new Promise<Blob>((res, rej) =>
      c.toBlob((b) => (b ? res(b) : rej(new Error('no-blob'))), 'image/jpeg', 0.92),
    );
    const file = new File([blob], fname, { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error('no-file-input');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fileName);
}

/** Создаёт СВОЙ наряд (master1 через API → worker01) с уникальным описанием. */
async function createOwnWorkerOrder(page: Page, tag: string): Promise<string | null> {
  return await page.evaluate(async (t) => {
    try {
      const login = async (l: string, p: string): Promise<string | null> => {
        const r = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: l, pin: p }),
        });
        if (!r.ok) return null;
        return ((await r.json()).access_token ?? null) as string | null;
      };
      const mat = await login('master1', '3333');
      const wat = await login('worker01', '1001');
      if (!mat || !wat) return null;
      const meRes = await fetch('/api/v1/me', { headers: { Authorization: `Bearer ${wat}` } });
      if (!meRes.ok) return null;
      const me = (await meRes.json()) as { id?: string; area_ids?: string[] };
      const eqRes = await fetch('/api/v1/equipment?limit=50', {
        headers: { Authorization: `Bearer ${mat}` },
      });
      if (!eqRes.ok) return null;
      const eq = (await eqRes.json()) as {
        data?: { id: string; area_id?: string }[];
        items?: { id: string; area_id?: string }[];
      };
      const pool = eq.data ?? eq.items ?? [];
      const areas = me.area_ids ?? [];
      // Исполнитель должен быть доступен на участке оборудования.
      const eqId = (pool.find((e) => e.area_id && areas.includes(e.area_id)) ?? pool[0])?.id;
      if (!eqId || !me.id) return null;
      const c = await fetch('/api/v1/work-orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mat}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'unplanned',
          description: `e2e-${t}-${Date.now()} живым стендом`,
          equipment_id: eqId,
          assignee_id: me.id,
          priority: 'high',
          due_at: new Date(Date.now() + 86400000).toISOString(),
          norm_minutes: 60,
          equipment_stopped: false,
        }),
      });
      if (!c.ok) return null;
      return ((await c.json()).id ?? null) as string | null;
    } catch {
      return null;
    }
  }, tag);
}

/** Отмена своего наряда (master1 через API; cancel требует reason_code). */
async function cancelOwnOrder(page: Page, id: string): Promise<string> {
  return await page.evaluate(async (oid) => {
    try {
      const r = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'master1', pin: '3333' }),
      });
      if (!r.ok) return `login-failed:${r.status}`;
      const mat = ((await r.json()).access_token ?? '') as string;
      const res = await fetch(`/api/v1/work-orders/${oid}/transitions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mat}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          reason_code: 'duplicate',
          client_at: new Date().toISOString(),
        }),
      });
      return res.ok ? 'cancelled' : `cancel-failed:${res.status}`;
    } catch (e) {
      return `cleanup-error:${String(e)}`;
    }
  }, id);
}

const createdOrderIds: string[] = [];

test.afterEach(async ({ page }) => {
  while (createdOrderIds.length > 0) {
    const id = createdOrderIds.pop() as string;
    try {
      const res = await cancelOwnOrder(page, id);
      // eslint-disable-next-line no-console
      console.log(`[cleanup] photo-privacy cancel ${id}: ${res}`);
    } catch {
      /* best effort */
    }
  }
});

/**
 * Доводит СВОЙ наряд до завершаемого: accept/start — через API отдельным
 * worker-логином (не трогает UI-сессию и localStorage), затем свежий goto
 * и UI открывает диалог завершения (без submit). API-подготовка вместо
 * кликов — устойчиво к параллельной нагрузке на общий стенд.
 */
async function prepareOwnOrder(page: Page, orderId: string): Promise<boolean> {
  return await page.evaluate(async (oid) => {
    try {
      const lr = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'worker01', pin: '1001' }),
      });
      if (!lr.ok) return false;
      const wat = ((await lr.json()).access_token ?? '') as string;
      const auth = { Authorization: `Bearer ${wat}`, 'Content-Type': 'application/json' };
      const now = new Date().toISOString();
      await fetch(`/api/v1/work-orders/${oid}/transitions`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ action: 'accept', client_at: now }),
      });
      await fetch(`/api/v1/work-orders/${oid}/transitions`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ action: 'start', client_at: now }),
      });
      const g = await fetch(`/api/v1/work-orders/${oid}`, {
        headers: { Authorization: `Bearer ${wat}` },
      });
      if (!g.ok) return false;
      const o = (await g.json()) as { allowed_actions?: string[] };
      return (o.allowed_actions ?? []).includes('complete');
    } catch {
      return false;
    }
  }, orderId);
}

async function openOwnCompleteDialog(page: Page, orderId: string): Promise<boolean> {
  const ready = await prepareOwnOrder(page, orderId);
  if (!ready) return false;
  await page.goto(`/worker/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
  const done = page.getByRole('button', { name: 'Завершить' }).first();
  await expect(done).toBeVisible({ timeout: 20000 });
  await done.click();
  return await page
    .getByRole('dialog', { name: 'Завершение наряда' })
    .isVisible()
    .catch(() => false);
}

/** Грузит живое after-фото в свой наряд (без submit), возвращает id фото. */
async function uploadOwnAfterPhoto(
  page: Page,
  orderId: string,
  token: string,
): Promise<string | null> {
  const posted = page.waitForResponse(
    (r) => r.url().includes(`/work-orders/${orderId}/photos`) && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await attachJpeg(page, 'privacy.jpg');
  const resp = await posted;
  if (!resp.ok()) return null;
  try {
    const body = (await resp.json()) as { id?: string; data?: { id?: string } };
    if (body?.id) return body.id;
    if (body?.data?.id) return body.data.id;
  } catch {
    /* fall through to list */
  }
  const list = await apiGet(page, `/work-orders/${orderId}/photos`, token);
  const raw = (list?.json ?? null) as { id: string }[] | { data?: { id: string }[] } | null;
  const items = Array.isArray(raw) ? raw : (raw?.data ?? []);
  return items.length ? items[items.length - 1].id : null;
}

async function setupOwnOrder(page: Page, tag: string): Promise<string> {
  const orderId = await createOwnWorkerOrder(page, tag);
  test.skip(!orderId, 'live stand: could not create own order for worker01');
  createdOrderIds.push(orderId as string);
  return orderId as string;
}

test('live: signed photo URL response carries url and expires_in', async ({ page }) => {
  await loginAsWorker(page);
  const orderId = await setupOwnOrder(page, 'privacy');
  expect(await openOwnCompleteDialog(page, orderId)).toBe(true);
  // Токен — ПОСЛЕ всех setup-логинов: новый вход отзывает старые сессии (auth.py),
  // захваченный раньше токен получил бы 401. Между захватом и использованием
  // новых логинов нет — токен жив.
  const apiToken = await apiTokenFor(page, 'worker01', '1001');
  test.skip(!apiToken, 'live stand: could not capture app token');
  const photoId = await uploadOwnAfterPhoto(page, orderId, apiToken as string);
  test.skip(!photoId, 'live stand: after-photo upload did not return an id');
  const signed = await apiGet(page, `/photos/${photoId}/url`, apiToken as string);
  expect(signed?.status).toBe(200);
  const body = (signed?.json ?? {}) as { url?: string; expires_in?: number };
  expect(String(body.url)).toMatch(/^https?:\/\//);
  expect(typeof body.expires_in).toBe('number');
});

test('live: foreign photo signed URL is denied with 404 and UI stays intact', async ({ page }) => {
  await loginAsWorker(page);
  const orderId = await setupOwnOrder(page, 'privacy');
  await page.goto(`/worker/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 20000 });

  const apiToken = await apiTokenFor(page, 'worker01', '1001');
  test.skip(!apiToken, 'live stand: could not capture app token');
  const foreign = await apiGet(
    page,
    '/photos/00000000-0000-0000-0000-000000000000/url',
    apiToken as string,
  );
  expect(foreign?.status).toBe(404);
  // UI не падает: карточка наряда на месте.
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/\/worker\/orders\//, { timeout: 15000 });
});

test('live: signed URL is not embedded into UI as a plain img', async ({ page }) => {
  await loginAsWorker(page);
  const orderId = await setupOwnOrder(page, 'privacy');
  expect(await openOwnCompleteDialog(page, orderId)).toBe(true);
  const apiToken = await apiTokenFor(page, 'worker01', '1001');
  test.skip(!apiToken, 'live stand: could not capture app token');
  const photoId = await uploadOwnAfterPhoto(page, orderId, apiToken as string);
  test.skip(!photoId, 'live stand: after-photo upload did not return an id');
  const signed = await apiGet(page, `/photos/${photoId}/url`, apiToken as string);
  const url = String((signed?.json as { url?: string } | null)?.url ?? '');
  test.skip(!url, 'live stand: no signed url returned');
  // Диалог завершения не встраивает подписанную ссылку как картинку.
  await expect(page.getByRole('dialog', { name: 'Завершение наряда' })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(`img[src="${url}"]`)).toHaveCount(0, { timeout: 15000 });
});
