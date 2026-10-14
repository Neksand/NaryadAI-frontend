import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: панель ИИ-ассистента (/assistant) против живого API
// http://127.0.0.1:8080/api/v1 (через vite dev-server /api proxy).
// No page.route mocks. Только чтение: вопросы к POST /assistant/chat,
// переход по citation-ссылке на живой наряд. Мутаций нет.
// CI-guard copied from e2e/manager-areas.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.
//
// NOTE: роут /assistant в src/App.tsx подводит координатор
// (ProtectedRoute allow master/manager/admin поверх AssistantPage).

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

async function loginAsMaster(page: Page) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('master1');
  await inputs.nth(1).fill('3333');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/master/, { timeout: 20000 });
}

/** Чистая история ассистента: каждый тест стартует с пустым диалогом. */
async function openAssistantFresh(page: Page) {
  await page.goto('/assistant', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('ИИ-ассистент')).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => localStorage.removeItem('naryadai.assistant-history.v1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('ИИ-ассистент')).toBeVisible({ timeout: 20000 });
}

async function ask(page: Page, text: string) {
  await page.getByLabel('ИИ-ассистент').fill(text);
  await page.getByRole('button', { name: 'Спросить' }).click();
}

test('live: вопрос про просроченные — ответ со ссылкой на живой наряд', async ({ page }) => {
  await loginAsMaster(page);
  await openAssistantFresh(page);

  await ask(page, 'Какие наряды просрочены?');

  // Ответ rule-based бэкенда: текст + citations → ссылки /master/orders/<uuid>.
  const cite = page.locator('a[href^="/master/orders/"]').first();
  await expect(cite).toBeVisible({ timeout: 20000 });
  const href = await cite.getAttribute('href');
  expect(href).toMatch(/^\/master\/orders\/[0-9a-f-]{36}$/);

  // Клик ведёт на живой наряд: URL с uuid + карточка с номером наряда.
  await cite.click();
  await expect(page).toHaveURL(/\/master\/orders\/[0-9a-f-]{36}/, { timeout: 20000 });
  await expect(page.getByText(/№\d+/).first()).toBeVisible({ timeout: 20000 });
});

test('live: повторный вопрос после reopen — история из 2 пар видна', async ({ page }) => {
  await loginAsMaster(page);
  await openAssistantFresh(page);

  await ask(page, 'Какие наряды просрочены?');
  await expect(page.locator('article')).toHaveCount(1, { timeout: 20000 });

  await ask(page, 'Что по смене?');
  await expect(page.locator('article')).toHaveCount(2, { timeout: 20000 });

  // Reopen страницы: история переживает перезагрузку (localStorage), 2 пары на месте.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('article')).toHaveCount(2, { timeout: 20000 });
  await expect(page.getByText('Какие наряды просрочены?')).toBeVisible();
  await expect(page.getByText('Что по смене?')).toBeVisible();
});
