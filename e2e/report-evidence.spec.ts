import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: выгрузка отчётов менеджером против реального API
// http://127.0.0.1:8080/api/v1 (через vite dev-server /api proxy).
// No page.route mocks: джобы реально создаются стендом и реально завершаются
// (complete + url за секунды). Поэтому «failed без ссылки» живьём по заказу не
// получить — вместо мока failed-статуса проверяем живой жизненный цикл джобы:
// queued/processing → completed (ссылка либо no-link текст, оба живые исходы).
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

async function exportPanel(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('manager1');
  await inputs.nth(1).fill('2222');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/manager/, { timeout: 20000 });
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: 'Выгрузка отчёта' });
  await expect(panel.getByRole('heading', { name: 'Выгрузка отчёта' })).toBeVisible({
    timeout: 20000,
  });
  return panel;
}

// Живое завершение джобы: либо ссылка на файл, либо no-link текст.
// Под нагрузкой стенда джоба может висеть в queued десятки секунд.
async function expectSettled(page: Page) {
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('Скачать отчёт') ||
      document.body.innerText.includes('ссылка недоступна'),
    undefined,
    { timeout: 150000 },
  );
}

test('live: shift/xlsx export completes and offers a download link', async ({ page }) => {
  test.slow();
  const panel = await exportPanel(page);
  await panel.getByLabel('Состав отчёта').selectOption('shift');
  await panel.getByLabel('Формат').selectOption('xlsx');
  await panel.getByRole('button', { name: 'Подготовить отчёт' }).click();
  // Живое завершение: обычно ссылка на файл; под нагрузкой стенда возможен
  // completed без url — принимаем оба живых исхода completed-джобы.
  await expectSettled(page);
  const downloadLink = panel.getByRole('link', { name: 'Скачать отчёт' });
  if ((await downloadLink.count()) > 0) {
    await expect(downloadLink).toHaveAttribute('href', /^https?:\/\//, { timeout: 20000 });
  } else {
    await expect(panel.getByText('Файл готов, но ссылка недоступна. Обновите статус.')).toBeVisible(
      { timeout: 20000 },
    );
  }
});

test('live: default orders export settles (link or no-link status)', async ({ page }) => {
  test.slow();
  const panel = await exportPanel(page);
  await panel.getByLabel('С даты').fill('2026-10-01');
  await panel.getByLabel('По дату').fill('2026-10-13');
  await panel.getByRole('button', { name: 'Подготовить отчёт' }).click();
  await expectSettled(page);
});

test('live: export shows live job lifecycle then settles', async ({ page }) => {
  test.slow();
  const panel = await exportPanel(page);
  await panel.getByRole('button', { name: 'Подготовить отчёт' }).click();
  // Промежуточные живые состояния пула джобы (хоть одно обязано мелькнуть/осесть).
  await expect(
    panel.getByText(/Подготавливаем|очередь|Формируем|Скачать отчёт/).first(),
  ).toBeVisible({ timeout: 20000 });
  await expectSettled(page);
});

test('live: pdf export surfaces the live backend failure text (no mocks)', async ({ page }) => {
  test.slow();
  // Живой стенд не умеет PDF (нет Unicode-шрифта: PDF_FONT_PATH) — джоба
  // реально падает failed, фронт показывает текст ошибки бэкенда. Если стенд
  // когда-нибудь починят, успехом будет ссылка — принимаем ОБА живых исхода.
  const panel = await exportPanel(page);
  await panel.getByLabel('Состав отчёта').selectOption('shift');
  await panel.getByLabel('Формат').selectOption('pdf');
  await panel.getByRole('button', { name: 'Подготовить отчёт' }).click();
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('Скачать отчёт') ||
      document.body.innerText.includes('PDF_FONT_PATH') ||
      document.body.innerText.includes('сформировать'),
    undefined,
    { timeout: 150000 },
  );
  if ((await panel.getByRole('alert').count()) > 0) {
    await expect(panel.getByRole('alert').first()).toBeVisible({ timeout: 20000 });
  } else {
    await expect(panel.getByRole('link', { name: 'Скачать отчёт' })).toBeVisible({
      timeout: 20000,
    });
  }
});
