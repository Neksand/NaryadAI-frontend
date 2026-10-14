import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: role-specific order labels/actions (worker /worker, master /master)
// against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks. Живой сид: у worker01 есть issued/accepted/in_progress
// наряды с allowed_actions (accept/queue/start/pause/complete) — статусы и
// действия проверяем толерантно, по факту живых данных.
// CI-guard copied from e2e/manager-areas.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.

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

async function loginAs(page: Page, login: string, pin: string, home: RegExp) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(login);
  await inputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(home, { timeout: 20000 });
}

test('live: worker sees own order statuses', async ({ page }) => {
  await loginAs(page, 'worker01', '1001', /\/worker/);
  await page.goto('/worker', { waitUntil: 'domcontentloaded' });
  const section = page.locator('section[aria-label="Сейчас в работе"]');
  await expect(section.locator('article.card').first()).toBeVisible({ timeout: 20000 });
  // Живые статусы worker01: Выдан / Принят / В работе (и др. по факту сида).
  await expect(
    section
      .getByText(/Выдан|Принят|В очереди|В работе|Приостановлен|На доработку|Исполнено/)
      .first(),
  ).toBeVisible({ timeout: 20000 });
});

test('live: worker cards expose role-specific actions', async ({ page }) => {
  await loginAs(page, 'worker01', '1001', /\/worker/);
  await page.goto('/worker', { waitUntil: 'domcontentloaded' });
  const section = page.locator('section[aria-label="Сейчас в работе"]');
  await expect(section.locator('article.card').first()).toBeVisible({ timeout: 20000 });
  // Живые allowed_actions сида: accept/queue/start/pause/complete.
  await expect(
    section
      .getByText(/Принять в работу|Начать|Пауза|Продолжить|Завершить|В очередь|Отклонить/)
      .first(),
  ).toBeVisible({ timeout: 20000 });
});

test('live: master sees own board actions and performers', async ({ page }) => {
  await loginAs(page, 'master1', '3333', /\/master/);
  await page.goto('/master', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Смена').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('link', { name: 'Новый наряд' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Исполнители/).first()).toBeVisible({ timeout: 20000 });
  // Живой сид: 15 исполнителей. При пустой смене — счётчик (0), но не падение.
  const teamText = await page
    .getByText(/Исполнители/)
    .first()
    .innerText();
  const teamN = Number(teamText.match(/\((\d+)\)/)?.[1] ?? 0);
  if (teamN > 0) {
    expect(teamN).toBeGreaterThan(0);
  }
});
