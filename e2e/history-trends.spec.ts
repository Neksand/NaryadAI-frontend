import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: история ремонтов оборудования в MasterOrder (секция RepairHistory,
// GET /equipment/:id/history) против живого API http://127.0.0.1:8080/api/v1
// (через vite dev-server /api proxy). No page.route mocks.
// CI-guard copied from e2e/manager-areas.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.
//
// Наряд открывается по живому id из GET /work-orders (Bearer через
// refresh-токен) — сид-данные заранее неизвестны, поэтому ассёрты толерантные:
// заголовок секции обязателен, а список/плейсхолдер/баннер повтора —
// по факту живых данных. Мутаций нет.

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

type OrderLite = { id: string; number?: number; description?: string; equipment_id?: string };

async function openLiveMasterOrder(page: Page, token: string, index = 0): Promise<OrderLite> {
  const res = await apiGet(page, '/work-orders?limit=50', token);
  const items = ((res?.json as { items?: OrderLite[] } | null)?.items ?? []).filter(
    (o) => o.equipment_id,
  );
  test.skip(items.length <= index, 'live stand has no master orders with equipment');
  const order = items[index];
  await page.goto(`/master/orders/${order.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'История ремонтов оборудования' })).toBeVisible({
    timeout: 20000,
  });
  return order;
}

test('live: past repairs list or empty placeholder is visible', async ({ page }) => {
  await loginAsMaster(page);
  const apiToken = await apiTokenFor(page, 'master1', '3333');
  test.skip(!apiToken, 'live stand: could not capture app token');
  await openLiveMasterOrder(page, apiToken as string, 0);
  // Живые данные: либо карточки истории (Наряд №), либо плейсхолдер.
  await expect(async () => {
    const cards = await page.getByText(/Наряд №\d+/).count();
    const stub = await page.getByText('По этому оборудованию ещё нет нарядов.').count();
    expect(cards + stub).toBeGreaterThan(0);
  }).toPass({ timeout: 20000 });
});

test('live: history section renders without crash (repeat banner if live data repeats)', async ({
  page,
}) => {
  await loginAsMaster(page);
  const apiToken = await apiTokenFor(page, 'master1', '3333');
  test.skip(!apiToken, 'live stand: could not capture app token');
  await openLiveMasterOrder(page, apiToken as string, 0);
  // Баннер повтора зависит от живых fault_code_id — проверяем стабильность
  // секции: заголовок + (список | плейсхолдер), баннер опционален.
  await expect(page.getByRole('heading', { name: 'История ремонтов оборудования' })).toBeVisible({
    timeout: 20000,
  });
  await expect(async () => {
    const cards = await page.getByText(/Наряд №\d+/).count();
    const stub = await page.getByText('По этому оборудованию ещё нет нарядов.').count();
    expect(cards + stub).toBeGreaterThan(0);
  }).toPass({ timeout: 20000 });
  // Сам факт рендера баннера (если повтор есть) не должен ронять страницу.
  await expect(page).toHaveURL(/\/master\/orders\//, { timeout: 15000 });
});

test('live: another order history renders placeholder or list', async ({ page }) => {
  await loginAsMaster(page);
  const apiToken = await apiTokenFor(page, 'master1', '3333');
  test.skip(!apiToken, 'live stand: could not capture app token');
  await openLiveMasterOrder(page, apiToken as string, 1);
  await expect(async () => {
    const cards = await page.getByText(/Наряд №\d+/).count();
    const stub = await page.getByText('По этому оборудованию ещё нет нарядов.').count();
    expect(cards + stub).toBeGreaterThan(0);
  }).toPass({ timeout: 20000 });
});
