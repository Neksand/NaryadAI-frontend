import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: worker order filters against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks. Счётчики вкладок — живые: равенство
// «счётчик вкладки == число карточек», сужение urgent <= all.
// Живой сид worker01: active>0, queue=0 → вкладка «Очередь» даёт EmptyState.
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

function tabCounter(page: Page, re: RegExp) {
  return page.getByRole('tab', { name: re });
}

async function tabCount(page: Page, re: RegExp): Promise<number> {
  const text = await tabCounter(page, re).innerText();
  return Number(text.match(/\((\d+)\)/)?.[1] ?? 0);
}

function activeCards(page: Page) {
  return page.locator('section[aria-label="Сейчас в работе"] article.card');
}

test('live: filters on /worker keep selection and narrow the list', async ({ page }) => {
  await loginAsWorker(page);
  await page.goto('/worker', { waitUntil: 'domcontentloaded' });
  await expect(activeCards(page).first()).toBeVisible({ timeout: 20000 });

  const allN = await tabCount(page, /Сейчас в работе/);
  expect(await activeCards(page).count()).toBe(allN);

  const urgentTab = tabCounter(page, /Срочные/);
  await urgentTab.click();
  await expect(urgentTab).toHaveAttribute('aria-selected', 'true');
  const urgentN = await tabCount(page, /Срочные/);
  expect(urgentN).toBeLessThanOrEqual(allN);
  expect(await activeCards(page).count()).toBe(urgentN);

  const allTab = tabCounter(page, /Сейчас в работе/);
  await allTab.click();
  await expect(allTab).toHaveAttribute('aria-selected', 'true');
  expect(await activeCards(page).count()).toBe(allN);
});

test('live: queue tab shows live cards or EmptyState', async ({ page }) => {
  await loginAsWorker(page);
  await page.goto('/worker', { waitUntil: 'domcontentloaded' });
  await expect(activeCards(page).first()).toBeVisible({ timeout: 20000 });

  const queueTab = tabCounter(page, /Очередь/);
  await queueTab.click();
  await expect(queueTab).toHaveAttribute('aria-selected', 'true');
  const queueN = await tabCount(page, /Очередь/);
  if (queueN === 0) {
    // Живой сид: у worker01 нет нарядов в очереди — фильтр даёт пустой результат.
    await expect(page.getByText('Пока пусто').first()).toBeVisible({ timeout: 20000 });
  } else {
    expect(await activeCards(page).count()).toBe(queueN);
  }
});
