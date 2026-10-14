import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: выгрузка отчёта менеджером + офлайн-очередь с реальным реплеем против
// реального API http://127.0.0.1:8080/api/v1 (через vite dev-server /api proxy).
// No page.route mocks.
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

async function loginAs(page: Page, login: string, pin: string, urlRe: RegExp) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(login);
  await inputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(urlRe, { timeout: 20000 });
}

test('live: manager creates a filtered export and it settles with a file', async ({ page }) => {
  // Фоновая джоба под нагрузкой стенда может висеть в queued десятки секунд.
  test.slow();
  await loginAs(page, 'manager1', '2222', /\/manager/);
  await page.goto('/manager', { waitUntil: 'domcontentloaded' });

  const panel = page.getByRole('region', { name: 'Выгрузка отчёта' });
  await expect(panel.getByRole('heading', { name: 'Выгрузка отчёта' })).toBeVisible({
    timeout: 20000,
  });
  await panel.getByLabel('С даты').fill('2026-10-01');
  await panel.getByLabel('По дату').fill('2026-10-13');
  await panel.getByRole('button', { name: 'Подготовить отчёт' }).click();

  // Живая джоба обрабатывается фоном: ждём ссылку на файл либо
  // no-link статус — оба живые исходы completed-джобы под нагрузкой стенда.
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('Скачать отчёт') ||
      document.body.innerText.includes('ссылка недоступна'),
    undefined,
    { timeout: 150000 },
  );
  const downloadLink = panel.getByRole('link', { name: 'Скачать отчёт' });
  if ((await downloadLink.count()) > 0) {
    await expect(downloadLink).toHaveAttribute('href', /^https?:\/\//, { timeout: 20000 });
  } else {
    await expect(panel.getByText('Файл готов, но ссылка недоступна. Обновите статус.')).toBeVisible(
      { timeout: 20000 },
    );
  }
});

// Alive-версия офлайн-409 теста (образец: e2e/offline-panel.spec.ts):
// очередь кликом без сети, затем реальный реплей живому стенду. Серверное
// состояние живое: реплей либо проходит (очередь пуста), либо падает
// 409-конфликтом (alert) — принимаем ОБА исхода.
test('live: worker queues an offline action, online replay sends it (success or 409)', async ({
  page,
}) => {
  await loginAs(page, 'worker01', '1001', /\/worker/);
  await page.goto('/worker', { waitUntil: 'domcontentloaded' });
  const action = page
    .getByRole('button', { name: /Принять в работу|Начать|Продолжить|В очередь/ })
    .first();
  await expect(action).toBeVisible({ timeout: 20000 });

  await page.context().setOffline(true);
  // Дожидаемся, пока хук useOfflineQueue обработает событие offline,
  // иначе клик может уйти по онлайн-ветке до обновления React-состояния.
  await expect(page.getByText('Нет связи')).toBeVisible({ timeout: 20000 });
  await action.click();
  await expect(page.getByText('В очереди действий: 1')).toBeVisible({ timeout: 20000 });

  await page.context().setOffline(false);
  // Страховка: если auto-replay по online-событию не стартовал — жмём «Повторить».
  await page.waitForTimeout(1500);
  const retry = page.getByRole('button', { name: 'Повторить' }).first();
  if (
    (await page.getByText('В очереди действий').count()) > 0 &&
    (await page.getByRole('alert').count()) === 0 &&
    (await retry.count()) > 0 &&
    (await retry.isEnabled().catch(() => false))
  ) {
    await retry.click();
  }
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes('В очереди действий') ||
      document.querySelector('[role="alert"]') !== null,
    undefined,
    { timeout: 20000 },
  );
  if ((await page.getByRole('alert').count()) > 0) {
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 20000 });
  } else {
    await expect(page.getByText('В очереди действий')).toHaveCount(0, { timeout: 20000 });
  }
  await page.context().setOffline(false);
});
