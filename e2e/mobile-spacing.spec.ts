import { expect, test, type Locator, type Page } from '@playwright/test';
import { requireLiveApi } from './live-api';

test.setTimeout(60_000);

// Live: проход по отступам и тапам на телефоне (320px и 390px) против живого API
// http://127.0.0.1:8080/api/v1 (через vite dev-server /api proxy). Без моков.
// Паттерн: e2e/login-layout.spec.ts (вьюпорты + замеры кнопок + скролл) и
// соседние live-спеки (gotoLogin с одноразовой чисткой стораджа + скип без стенда).
// CI-guard двойной: requireLiveApi(request) + page-проверка, как у соседей.

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

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectTapTarget(locator: Locator, min = 44) {
  await expect(locator).toBeVisible({ timeout: 20000 });
  const box = await locator.boundingBox();
  expect(box, 'tap target has no bounding box').not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(min);
  expect(box!.width).toBeGreaterThanOrEqual(min);
}

async function expectCardsFitViewport(page: Page, width: number) {
  const count = await page.locator('main .card').count();
  for (let i = 0; i < Math.min(count, 6); i++) {
    const box = await page.locator('main .card').nth(i).boundingBox();
    if (box) expect(box.width).toBeLessThanOrEqual(width + 1);
  }
}

for (const width of [320, 390]) {
  test(`live: login usable at ${width}px — no h-scroll, sign-in tap >= 44`, async ({
    page,
    request,
  }) => {
    await requireLiveApi(request);
    await page.setViewportSize({ width, height: 844 });
    await gotoLogin(page);
    const signIn = page.getByRole('button', { name: 'Войти', exact: true });
    await expectTapTarget(signIn);
    await expectNoHorizontalScroll(page);
  });

  test(`live: worker home at ${width}px — no h-scroll, filter taps >= 44`, async ({
    page,
    request,
  }) => {
    await requireLiveApi(request);
    await page.setViewportSize({ width, height: 844 });
    await loginAs(page, 'worker01', '1001', /\/worker/);
    await page.goto('/worker', { waitUntil: 'domcontentloaded' });
    // Фильтры-табы всегда на экране (вне query-состояний) — стабильная мишень.
    const firstTab = page.getByRole('tab').first();
    await expectTapTarget(firstTab);
    // Толерантно к данным: либо карточки нарядов, либо пустое состояние.
    await expect(async () => {
      const cards = await page.locator('a[href*="/worker/orders/"]').count();
      const empty = await page.getByText('Пока пусто').count();
      expect(cards + empty).toBeGreaterThan(0);
    }).toPass({ timeout: 20000 });
    await expectCardsFitViewport(page, width);
    await expectNoHorizontalScroll(page);
  });

  test(`live: master board at ${width}px — no h-scroll, section toggles >= 44`, async ({
    page,
    request,
  }) => {
    await requireLiveApi(request);
    await page.setViewportSize({ width, height: 844 });
    await loginAs(page, 'master1', '3333', /\/master/);
    await page.goto('/master/board', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Доска').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('section[aria-label]')).toHaveCount(6, { timeout: 20000 });
    await expectTapTarget(page.locator('a[href="/master/new"]'));
    const firstToggle = page.locator('section[aria-label] button[aria-expanded]').first();
    await expectTapTarget(firstToggle);
    await expectCardsFitViewport(page, width);
    await expectNoHorizontalScroll(page);
  });

  test(`live: manager dashboard at ${width}px — no h-scroll, tab taps >= 44`, async ({
    page,
    request,
  }) => {
    await requireLiveApi(request);
    await page.setViewportSize({ width, height: 844 });
    await loginAs(page, 'manager1', '2222', /\/manager/);
    await page.goto('/manager', { waitUntil: 'domcontentloaded' });
    const firstTab = page.getByRole('tab').first();
    await expectTapTarget(firstTab);
    await expectCardsFitViewport(page, width);
    await expectNoHorizontalScroll(page);
  });

  test(`live: notifications at ${width}px — no h-scroll, cards fit viewport`, async ({
    page,
    request,
  }) => {
    await requireLiveApi(request);
    await page.setViewportSize({ width, height: 844 });
    await loginAs(page, 'worker01', '1001', /\/worker/);
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    // Живые уведомления стенда рендерятся карточками; ждём хотя бы одну.
    await expect
      .poll(async () => page.locator('main .card').count(), { timeout: 20000 })
      .toBeGreaterThan(0);
    await expectCardsFitViewport(page, width);
    await expectNoHorizontalScroll(page);
  });
}
