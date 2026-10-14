import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: AI suggest-assignee against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks.
// NOTE: 429 rate_limited живьём не воспроизвести — у стенда нет ручки,
// провоцирующей лимит, и долбить его спамом нельзя. Поэтому проверяем живую
// деградацию честно: suggest реально отвечает, карточек не больше трёх,
// Apply подставляет исполнителя, а без описания кнопка ИИ задизейблена и
// форма остаётся рабочей (выдача не блокируется отсутствием ИИ).
// На autocommit/POST /work-orders не идём — не мутируем общий стенд.
// CI-guard: without a live stand the tests skip (no live API in CI).

async function gotoLogin(page: Page) {
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

async function firstRealOptionValue(select: ReturnType<Page['getByLabel']>) {
  await expect(select.locator('option:not([value=""])')).not.toHaveCount(0, { timeout: 20000 });
  return (await select.locator('option:not([value=""])').first().getAttribute('value')) as string;
}

async function openMasterNew(page: Page) {
  await loginAsMaster(page);
  await page.goto('/master/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radiogroup', { name: 'Тип работ' })).toBeVisible({ timeout: 20000 });
}

test('live: suggest returns candidates, apply fills assignee (max 3 cards)', async ({ page }) => {
  await openMasterNew(page);
  await page
    .getByLabel(/Участок/)
    .selectOption(await firstRealOptionValue(page.getByLabel(/Участок/)));
  await page.locator('textarea').fill('Насос шумит и течёт вторые сутки');
  const aiButton = page.getByRole('button', { name: 'Рекомендация ИИ' });
  await expect(aiButton).toBeEnabled({ timeout: 20000 });
  const resp = page.waitForResponse(
    (r) => r.url().includes('/ai/suggest-assignee') && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await aiButton.click();
  await resp;
  // Живой suggest отвечает кандидатами: кнопка снова активна, карточек 1..3.
  await expect(aiButton).toBeEnabled({ timeout: 20000 });
  await expect
    .poll(async () => page.getByRole('button', { name: 'Применить' }).count(), { timeout: 20000 })
    .toBeGreaterThan(0);
  const n = await page.getByRole('button', { name: 'Применить' }).count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(3);
  await expect(page.getByText(/Уверенность/).first()).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Применить' }).first().click();
  await expect
    .poll(async () => page.getByLabel(/человек или бригада/).inputValue(), { timeout: 15000 })
    .not.toBe('');
});

test('live: AI button is gated without description, form stays usable', async ({ page }) => {
  await openMasterNew(page);
  await page
    .getByLabel(/Участок/)
    .selectOption(await firstRealOptionValue(page.getByLabel(/Участок/)));
  // Без описания кнопка ИИ задизейблена — лимит/ошибка ИИ не блокируют форму.
  await expect(page.getByRole('button', { name: 'Рекомендация ИИ' })).toBeDisabled({
    timeout: 15000,
  });
  await page.locator('textarea').fill('Насос шумит и течёт вторые сутки');
  await expect(page.getByRole('button', { name: 'Рекомендация ИИ' })).toBeEnabled({
    timeout: 15000,
  });
});

test('live: issue form stays submittable with manual crew when AI is skipped', async ({ page }) => {
  await openMasterNew(page);
  await page
    .getByLabel(/Участок/)
    .selectOption(await firstRealOptionValue(page.getByLabel(/Участок/)));
  await page
    .getByLabel(/Оборудование/)
    .selectOption(await firstRealOptionValue(page.getByLabel(/Оборудование/)));
  await page.getByPlaceholder('дд.мм.гггг, чч:мм').fill('20.10.2026, 12:00');
  await page.locator('textarea').fill('Насос шумит и течёт вторые сутки');
  await page
    .getByLabel('Бригада (или)')
    .selectOption(await firstRealOptionValue(page.getByLabel('Бригада (или)')));
  // Не сабмитим (не мутируем стенд): достаточно того, что выдача разблокирована без ИИ.
  await expect(page.getByRole('button', { name: 'Новый наряд' })).toBeEnabled({ timeout: 20000 });
});
