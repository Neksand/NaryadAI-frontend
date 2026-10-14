import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: AI brigade recommendations (suggest-assignee + teams) against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks.
// NOTE: 500 ai_unavailable живьём детерминированно не вызвать (ручки
// гашения ИИ у стенда нет), поэтому проверяем живой happy path suggest →
// Apply подставляет исполнителя, а fallback-поверхность (ручной выбор
// бригады разблокирует выдачу без ИИ) — отдельным тестом без сабмита,
// чтобы не мутировать общий стенд.
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

async function firstRealOptionValue(select: ReturnType<Page['getByLabel']>) {
  await expect(select.locator('option:not([value=""])')).not.toHaveCount(0, { timeout: 20000 });
  return (await select.locator('option:not([value=""])').first().getAttribute('value')) as string;
}

async function openMasterNewWithArea(page: Page) {
  await loginAsMaster(page);
  await page.goto('/master/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radiogroup', { name: 'Тип работ' })).toBeVisible({ timeout: 20000 });
  await page
    .getByLabel(/Участок/)
    .selectOption(await firstRealOptionValue(page.getByLabel(/Участок/)));
  await page.locator('textarea').fill('Насос шумит и течёт вторые сутки');
}

test('live: suggestAssignee returns live candidates with apply', async ({ page }) => {
  await openMasterNewWithArea(page);
  const aiButton = page.getByRole('button', { name: 'Рекомендация ИИ' });
  await expect(aiButton).toBeEnabled({ timeout: 20000 });
  const resp = page.waitForResponse(
    (r) => r.url().includes('/ai/suggest-assignee') && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await aiButton.click();
  const body = (await (await resp).json()) as {
    suggestions?: { employee_id?: string; id?: string }[];
    candidates?: { employee_id?: string; id?: string }[];
  };
  const first = (body.suggestions ?? body.candidates ?? [])[0];
  expect(first).toBeTruthy();
  const expectedId = first?.employee_id ?? first?.id ?? '';
  expect(expectedId).not.toBe('');
  await expect(page.getByRole('button', { name: 'Применить' }).first()).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Применить' }).first().click();
  // Применение рекомендации подставляет исполнителя из живого ответа.
  await expect(page.getByLabel(/человек или бригада/)).toHaveValue(expectedId, { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Новый наряд' })).toBeDisabled();
});

test('live: manual brigade choice keeps issuing available without AI (no submit)', async ({
  page,
}) => {
  await openMasterNewWithArea(page);
  await page
    .getByLabel(/Оборудование/)
    .selectOption(await firstRealOptionValue(page.getByLabel(/Оборудование/)));
  await page.getByPlaceholder('дд.мм.гггг, чч:мм').fill('20.10.2026, 12:00');
  // ИИ не трогаем вообще: ручной выбор живой бригады разблокирует выдачу.
  await page
    .getByLabel('Бригада (или)')
    .selectOption(await firstRealOptionValue(page.getByLabel('Бригада (или)')));
  await expect(page.getByRole('button', { name: 'Применить' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Новый наряд' })).toBeEnabled({ timeout: 20000 });
});
