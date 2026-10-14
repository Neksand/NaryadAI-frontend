import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: /master/new against the real API http://127.0.0.1:8080/api/v1
// (through the vite dev-server /api proxy). No page.route mocks.
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

function itemsOf(body: unknown): { id: string; login?: string }[] {
  if (Array.isArray(body)) return body;
  const o = (body ?? {}) as Record<string, unknown>;
  if (Array.isArray(o.items)) return o.items as { id: string; login?: string }[];
  if (Array.isArray(o.data)) return o.data as { id: string; login?: string }[];
  return [];
}

// worker01 нужен живым id для селекта исполнителя (имена сида могут меняться).
async function worker01Id(request: APIRequestContext): Promise<string> {
  const login = await request.post('/api/v1/auth/login', {
    data: { login: 'master1', pin: '3333' },
  });
  expect(login.status()).toBe(200);
  const token = (await login.json()).access_token as string;
  const res = await request.get('/api/v1/workers', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const workers = itemsOf(await res.json());
  const w01 = workers.find((w) => w.login === 'worker01');
  expect(w01?.id).toBeTruthy();
  return w01!.id;
}

function dueInput(): string {
  const d = new Date(Date.now() + 2 * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function fillLiveOrderForm(page: Page, request: APIRequestContext, description: string) {
  // Тип работ: плановый (complete planned живьём — без фото).
  await page.getByRole('radio', { name: 'Плановый', exact: true }).click();
  // Участок: первый непустой option; оборудование грузится по участку — ждём options.
  const area = page.getByLabel(/Участок/);
  await expect(area).toBeVisible({ timeout: 20000 });
  await area.selectOption({ index: 1 });
  const equipment = page.getByLabel(/Оборудование/);
  await expect(async () => {
    expect(await equipment.locator('option').count()).toBeGreaterThan(1);
  }).toPass({ timeout: 20000 });
  await equipment.selectOption({ index: 1 });
  await page.getByPlaceholder('дд.мм.гггг, чч:мм').fill(dueInput());
  await page.locator('textarea').fill(description);
  await page.getByLabel(/человек или бригада/).selectOption(await worker01Id(request));
}

test('live: master sees the quick-issue form', async ({ page }) => {
  await loginAsMaster(page);
  await page.goto('/master/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radiogroup', { name: 'Тип работ' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Описание проблемы').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Новый наряд' })).toBeVisible({ timeout: 20000 });
});

test('live: planned quick-issue with unique description redirects to its card', async ({
  page,
  request,
}) => {
  const description = `e2e-${Date.now()} проверка редиректа`;
  await loginAsMaster(page);
  await page.goto('/master/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radiogroup', { name: 'Тип работ' })).toBeVisible({ timeout: 20000 });

  await fillLiveOrderForm(page, request, description);
  const submit = page.getByRole('button', { name: 'Новый наряд' });
  await expect(submit).toBeEnabled({ timeout: 20000 });
  await submit.click();
  // Живой create возвращает uuid: редирект на карточку созданного наряда.
  await expect(page).toHaveURL(/\/master\/orders\/[0-9a-f-]{36}/, { timeout: 20000 });
  await expect(page.getByText(description).first()).toBeVisible({ timeout: 20000 });
});
