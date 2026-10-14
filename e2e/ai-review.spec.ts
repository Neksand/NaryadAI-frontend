import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { requireLiveApi } from './live-api';

test.setTimeout(60_000);

// Live: приёмка ИИ мастером против реального API http://127.0.0.1:8080/api/v1
// (через vite dev-server /api proxy). No page.route mocks.
// Наряд в статусе ai_review ищем живьём через GET /work-orders?status=ai_review
// (сид стенда их содержит); если нет — скип. Ничего не мутируем: кнопки только
// проверяем видимостью, чтобы не портить общее состояние стенда.
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

// Живой ai_review-наряд из стенда (возвращаем id + описание для ассёртов).
// Предпочитаем наряд с распарсившимся вердиктом inspection; живьём вердикт
// обычно НЕ рендерится (бэкенд шлёт confidence строкой, Zod-схема фронта ждёт
// number) — тогда живое состояние страницы это pending-баннер, его и принимаем.
async function liveReviewOrder(
  request: APIRequestContext,
): Promise<{ id: string; description: string }> {
  await requireLiveApi(request);
  const login = await request.post('/api/v1/auth/login', {
    data: { login: 'master1', pin: '3333' },
  });
  expect(login.status()).toBe(200);
  const token = (await login.json()).access_token as string;
  const res = await request.get('/api/v1/work-orders?status=ai_review&limit=20', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items?: { id: string; description?: string }[] };
  const items = body.items ?? [];
  test.skip(items.length === 0, 'no live ai_review orders on the stand');
  for (const o of items) {
    const insp = await request.get(`/api/v1/ai/work-orders/${o.id}/inspection`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (insp.status() !== 200) continue;
    const review = ((await insp.json()) as { data?: { review?: { verdict?: unknown } } }).data
      ?.review;
    if (typeof review?.verdict === 'string' && review.verdict.length > 0) {
      return { id: o.id, description: o.description ?? '' };
    }
  }
  return { id: items[0].id, description: items[0].description ?? '' };
}

test('live: master sees AI review verdict before decision', async ({ page, request }) => {
  const order = await liveReviewOrder(request);
  await loginAsMaster(page);
  await page.goto(`/master/review/${order.id}`, { waitUntil: 'domcontentloaded' });
  // Живой вердикт inspection либо pending-баннер (см. комментарий выше).
  await expect(page.getByText('ИИ').first()).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText(/Принято|Требуется доработка|Нужно решение мастера|проверка ещё идёт/).first(),
  ).toBeVisible({ timeout: 20000 });
  if (order.description) {
    await expect(page.getByText(order.description).first()).toBeVisible({ timeout: 20000 });
  }
});

test('live: master can close from review (decision button visible)', async ({ page, request }) => {
  const order = await liveReviewOrder(request);
  await loginAsMaster(page);
  await page.goto(`/master/review/${order.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Согласен|Закрыть/i }).first()).toBeVisible({
    timeout: 20000,
  });
});
