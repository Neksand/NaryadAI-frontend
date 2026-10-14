import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: страница оборудования /equipment/:id + QR-контракт против живого API
// http://127.0.0.1:8080/api/v1 (через vite dev-server /api proxy).
// Без моков: в файле нет ни одного page.route — только живые fetch.
// CI-guard скопирован из e2e/manager-areas.spec.ts: без живого стенда тесты
// скипаются (в CI живого API нет); со стендом гоняются по-настоящему.
//
// Роут /equipment/:id подводит координатор (src/App.tsx здесь не трогаем);
// src/pages/Equipment.tsx читает :id из useParams.

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

async function loginAsMaster(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('master1');
  await inputs.nth(1).fill('3333');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/master/, { timeout: 20000 });
}

/**
 * Отдельный API-токен через прямой логин (НЕ трогает UI-сессию и localStorage:
 * access-токены разных логинов живут параллельно, refresh не дёргаем —
 * ротации и разлогина UI нет).
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

interface LiveEquipment {
  id: string;
  name?: string;
  inventory_no?: string;
  qr_token?: string;
}

async function liveEquipmentList(page: Page, token: string): Promise<LiveEquipment[]> {
  const res = await apiGet(page, '/dict/equipment', token);
  const items = ((res?.json as { items?: LiveEquipment[] } | null)?.items ?? []).filter(
    (e) => e?.id,
  );
  test.skip(items.length === 0, 'live stand has no equipment in seed');
  return items;
}

// Первый живой NAR-токен по контракту сида NAR-00001..NAR-00025: в списке
// /dict/equipment поля qr_token может не быть, поэтому перебираем by-qr
// до первого 200 и забираем id + инв-номер из ответа.
async function firstLiveQr(
  page: Page,
  token: string,
): Promise<{ token: string; id: string; inventory_no: string }> {
  for (let n = 1; n <= 25; n++) {
    const t = `NAR-${String(n).padStart(5, '0')}`;
    const res = await apiGet(page, `/equipment/by-qr/${t}`, token);
    const body = res?.json as { id?: string; inventory_no?: string } | null;
    if (res?.status === 200 && body?.id)
      return { token: t, id: body.id, inventory_no: body.inventory_no ?? '' };
  }
  test.skip(true, 'live stand has no NAR-00001..NAR-00025 equipment');
  throw new Error('unreachable');
}

test('live: карточка оборудования показывает инв-номер из живого списка', async ({ page }) => {
  await loginAsMaster(page);
  const apiToken = await apiTokenFor(page, 'master1', '3333');
  test.skip(!apiToken, 'live stand: could not get api token');
  const list = await liveEquipmentList(page, apiToken as string);
  const first = list[0];
  await page.goto(`/equipment/${first.id}`, { waitUntil: 'domcontentloaded' });
  // Инв-номер — из живого списка, не захардкожен.
  await expect(page.getByText(first.inventory_no as string, { exact: true })).toBeVisible({
    timeout: 20000,
  });
  if (first.name) await expect(page.getByText(first.name).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'История ремонтов оборудования' })).toBeVisible({
    timeout: 20000,
  });
});

test('live: поиск по QR-токену открывает то же оборудование', async ({ page }) => {
  await loginAsMaster(page);
  const apiToken = await apiTokenFor(page, 'master1', '3333');
  test.skip(!apiToken, 'live stand: could not get api token');
  const qr = await firstLiveQr(page, apiToken as string);
  const list = await liveEquipmentList(page, apiToken as string);
  // Стартуем с чужой карточки, чтобы переход по QR был виден в URL.
  const start = list.find((e) => e.id !== qr.id) ?? list[0];
  await page.goto(`/equipment/${start.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(start.inventory_no as string, { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await page.getByLabel('QR-токен').fill(qr.token);
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page).toHaveURL(new RegExp(`/equipment/${qr.id}`), { timeout: 20000 });
  await expect(page.getByText(qr.inventory_no, { exact: true })).toBeVisible({ timeout: 20000 });
});

test('live: невалидный QR-токен показывает ошибку', async ({ page }) => {
  await loginAsMaster(page);
  const apiToken = await apiTokenFor(page, 'master1', '3333');
  test.skip(!apiToken, 'live stand: could not get api token');
  const list = await liveEquipmentList(page, apiToken as string);
  await page.goto(`/equipment/${list[0].id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(list[0].inventory_no as string, { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await page.getByLabel('QR-токен').fill('NOPE-XXXX');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20000 });
});

test('live: deep-link /equipment/:id стабилен после reload', async ({ page }) => {
  await loginAsMaster(page);
  const apiToken = await apiTokenFor(page, 'master1', '3333');
  test.skip(!apiToken, 'live stand: could not get api token');
  const list = await liveEquipmentList(page, apiToken as string);
  const first = list[0];
  await page.goto(`/equipment/${first.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(first.inventory_no as string, { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(page).toHaveURL(new RegExp(`/equipment/${first.id}`), { timeout: 20000 });
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/equipment/${first.id}`), { timeout: 20000 });
  await expect(page.getByText(first.inventory_no as string, { exact: true })).toBeVisible({
    timeout: 20000,
  });
});
