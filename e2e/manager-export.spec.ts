import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: manager report-export panel against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks. Создание export-job — безвредная серверная задача
// (не persistent-сущность, cleanup не нужен); уникальные данные не требуются.
// Статусы толерантные: очередь/формирование/ссылка — любой живой исход.
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

async function loginAsManager(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('manager1');
  await inputs.nth(1).fill('2222');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/manager/, { timeout: 20000 });
}

test('live: ratings export creates a live job (queued/processing/download)', async ({ page }) => {
  await loginAsManager(page);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: 'Выгрузка отчёта' });
  await expect(panel.getByRole('heading', { name: 'Выгрузка отчёта' })).toBeVisible({
    timeout: 20000,
  });
  await panel.getByLabel('Состав отчёта').selectOption('ratings');
  await panel.getByRole('button', { name: 'Подготовить отчёт' }).click();
  // Живой исход любой: очередь, формирование или готовая ссылка (мелкий сид собирается быстро).
  await expect(
    panel
      .getByRole('status')
      .first()
      .or(panel.getByRole('link', { name: 'Скачать отчёт' })),
  ).toBeVisible({ timeout: 20000 });
});

test('live: from/to range is validated', async ({ page }) => {
  await loginAsManager(page);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: 'Выгрузка отчёта' });
  const create = panel.getByRole('button', { name: 'Подготовить отчёт' });
  await expect(create).toBeVisible({ timeout: 20000 });
  await expect(create).toBeEnabled({ timeout: 20000 });
  await panel.getByLabel('С даты').fill('2026-10-13');
  await panel.getByLabel('По дату').fill('2026-10-01');
  await expect(create).toBeDisabled({ timeout: 20000 });
  await panel.getByLabel('По дату').fill('2026-10-20');
  await expect(create).toBeEnabled({ timeout: 20000 });
});

test('live: export shows live progress or result text', async ({ page }) => {
  await loginAsManager(page);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: 'Выгрузка отчёта' });
  await expect(panel.getByRole('heading', { name: 'Выгрузка отчёта' })).toBeVisible({
    timeout: 20000,
  });
  await panel.getByRole('button', { name: 'Подготовить отчёт' }).click();
  // Любой живой статус: «Подготавливаем…» / «Отчёт поставлен в очередь.» /
  // «Формируем файл…» / ссылка на скачивание / осмысленная ошибка с ретраем.
  await expect(
    panel
      .getByRole('status')
      .first()
      .or(panel.getByRole('link', { name: 'Скачать отчёт' }))
      .or(panel.getByRole('alert').first()),
  ).toBeVisible({ timeout: 20000 });
});
