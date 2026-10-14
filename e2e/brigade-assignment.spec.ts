import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: brigade assignment (teams + crews dict) against the real API
// http://127.0.0.1:8080/api/v1 (through the vite dev-server /api proxy).
// No page.route mocks.
// NOTE: создание бригады/наряда живьём не выполняем — не мутируем общий
// стенд. Проверяем живые read-пути: справочник бригад у админа непуст,
// селект бригад у мастера содержит живые «Бригада N», выбор бригады
// разблокирует выдачу (без сабмита).
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

async function loginAs(page: Page, login: string, pin: string, home: RegExp) {
  await gotoLogin(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(login);
  await inputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(home, { timeout: 20000 });
}

async function firstRealOptionValue(select: ReturnType<Page['getByLabel']>) {
  await expect(select.locator('option:not([value=""])')).not.toHaveCount(0, { timeout: 20000 });
  return (await select.locator('option:not([value=""])').first().getAttribute('value')) as string;
}

test('live: admin crews dictionary shows live brigades', async ({ page }) => {
  await loginAs(page, 'admin', '1234', /\/admin/);
  const crewsTab = page.getByRole('button', { name: 'Бригады' });
  await expect(crewsTab).toBeVisible({ timeout: 20000 });
  await crewsTab.click();
  await expect
    .poll(async () => page.locator('table.tbl tbody tr').count(), { timeout: 20000 })
    .toBeGreaterThan(0);
});

test('live: master sees live brigades in the crew select when issuing', async ({ page }) => {
  await loginAs(page, 'master1', '3333', /\/master/);
  await page.goto('/master/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radiogroup', { name: 'Тип работ' })).toBeVisible({ timeout: 20000 });
  const crew = page.getByLabel('Бригада (или)');
  await expect(crew).toBeVisible({ timeout: 20000 });
  await expect(crew).toContainText(/Бригада/, { timeout: 20000 });
  expect(await crew.locator('option:not([value=""])').count()).toBeGreaterThan(0);
});

test('live: choosing a crew unlocks issuing (no submit, no mutation)', async ({ page }) => {
  await loginAs(page, 'master1', '3333', /\/master/);
  await page.goto('/master/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radiogroup', { name: 'Тип работ' })).toBeVisible({ timeout: 20000 });
  await page
    .getByLabel(/Участок/)
    .selectOption(await firstRealOptionValue(page.getByLabel(/Участок/)));
  await page
    .getByLabel(/Оборудование/)
    .selectOption(await firstRealOptionValue(page.getByLabel(/Оборудование/)));
  await page.getByPlaceholder('дд.мм.гггг, чч:мм').fill('20.10.2026, 12:00');
  await page.locator('textarea').fill('Насос шумит, течь масла');
  const crewValue = await firstRealOptionValue(page.getByLabel('Бригада (или)'));
  await page.getByLabel('Бригада (или)').selectOption(crewValue);
  await expect(page.getByLabel('Бригада (или)')).toHaveValue(crewValue, { timeout: 15000 });
  // Выбор бригады подставляет crew_id: исполнитель сброшен, выдача разблокирована.
  await expect(page.getByLabel(/человек или бригада/)).toHaveValue('', { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Новый наряд' })).toBeEnabled({ timeout: 20000 });
});
