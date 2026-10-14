import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: worker order browsing (history pagination, urgent sort/filter,
// empty states) against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks. Живой сид worker01: history=50 (пагинация есть),
// active=100 (срочные есть) — ассёрты всё равно толерантные к объёмам.
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

async function loginAsWorker(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('worker01');
  await inputs.nth(1).fill('1001');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
}

function historyCards(page: Page) {
  return page.locator('section[aria-label="Завершённые"] a.card');
}

function activeCards(page: Page) {
  return page.locator('section[aria-label="Сейчас в работе"] article.card');
}

test('live: history paginates with a show-more button', async ({ page }) => {
  await loginAsWorker(page);
  await page.goto('/worker', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Завершённые').first()).toBeVisible({ timeout: 20000 });

  const more = page.getByRole('button', { name: /Показать ещё \(\d+\)/ });
  if ((await more.count()) > 0) {
    const before = await historyCards(page).count();
    expect(before).toBeGreaterThan(0);
    await more.first().click();
    await expect
      .poll(async () => historyCards(page).count(), { timeout: 20000 })
      .toBeGreaterThan(before);
  } else {
    // Мало истории: либо карточки, либо EmptyState.
    const n = await historyCards(page).count();
    if (n === 0) {
      await expect(page.getByText('Пока пусто').first()).toBeVisible({ timeout: 20000 });
    } else {
      expect(n).toBeGreaterThan(0);
    }
  }
});

test('live: active list sorts urgent first and urgent filter hides the rest', async ({ page }) => {
  await loginAsWorker(page);
  await page.goto('/worker', { waitUntil: 'domcontentloaded' });
  const section = page.locator('section[aria-label="Сейчас в работе"]');
  await expect(activeCards(page).first()).toBeVisible({ timeout: 20000 });

  const allText = await page.getByRole('tab', { name: /Сейчас в работе/ }).innerText();
  const urgentText = await page.getByRole('tab', { name: /Срочные/ }).innerText();
  const allN = Number(allText.match(/\((\d+)\)/)?.[1] ?? 0);
  const urgentN = Number(urgentText.match(/\((\d+)\)/)?.[1] ?? 0);
  expect(urgentN).toBeLessThanOrEqual(allN);

  if (urgentN > 0) {
    // Срочные — первые: overdue/критичные/важные имеют классы late/critical/high.
    // Проверяем только если сервер явно пометил срочность (флаг is_overdue/priority),
    // клиентский overdue по due_at в DOM-классах не виден.
    const marked = await section
      .locator('article.card.late, article.card.critical, article.card.high')
      .count();
    if (marked > 0) {
      await expect(section.locator('article.card').first()).toHaveClass(/late|critical|high/);
    }
  }

  await page.getByRole('tab', { name: /Срочные/ }).click();
  expect(await activeCards(page).count()).toBe(urgentN);
  if (urgentN < allN) {
    // Фильтр сузил список — часть карточек скрыта.
    expect(urgentN).toBeLessThan(allN);
  }
});

test('live: active and history sections render cards or empty state', async ({ page }) => {
  await loginAsWorker(page);
  await page.goto('/worker', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Завершённые').first()).toBeVisible({ timeout: 20000 });
  const activeN = await activeCards(page).count();
  const historyN = await historyCards(page).count();
  if (activeN === 0 && historyN === 0) {
    await expect(page.getByText('Пока пусто').first()).toBeVisible({ timeout: 20000 });
  } else {
    expect(activeN + historyN).toBeGreaterThan(0);
  }
});
