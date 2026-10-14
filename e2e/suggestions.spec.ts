import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

// Live: suggest-assignee в MasterNew (/master/new) против живого API
// http://127.0.0.1:8080/api/v1 (через vite dev-server /api proxy).
// No page.route mocks.
// CI-guard copied from e2e/manager-areas.spec.ts: without a live stand the
// tests skip (no live API in CI); with the stand up they run for real.
//
// Живой ИИ может вернуть пустых кандидатов — ассёрты толерантные.
// МУТАЦИИ — только строго изолированные: наряд с уникальным описанием
// e2e-suggest-<timestamp> создаётся без участия ИИ и сразу отменяется
// (transitions cancel) в тесте + страховочный afterEach. Чужие наряды не трогаем.

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

/** Выбрать первую непустую опцию живого селекта. */
async function selectFirstOption(select: ReturnType<Page['locator']>): Promise<string | null> {
  // Живой каталог подгружается асинхронно — ждём опции, иначе count снимет скелетон.
  await expect
    .poll(async () => select.locator('option').count(), { timeout: 20000 })
    .toBeGreaterThan(1);
  const options = select.locator('option');
  const n = await options.count();
  for (let i = 1; i < n; i++) {
    const v = await options.nth(i).getAttribute('value');
    if (v) {
      await select.selectOption(v);
      return v;
    }
  }
  return null;
}

/** Дождаться подгрузки опций живого селекта (справочники грузятся асинхронно). */
async function waitOptions(select: ReturnType<Page['locator']>, timeout = 15000): Promise<void> {
  await expect(async () => {
    expect(await select.locator('option').count()).toBeGreaterThan(1);
  }).toPass({ timeout });
}

async function fillAreaAndDescription(page: Page, description: string) {
  const area = page.getByLabel(/Участок/);
  await waitOptions(area);
  expect(await selectFirstOption(area)).toBeTruthy();
  await page.locator('textarea').fill(description);
}

/**
 * Отдельный API-токен через прямой логин ( НЕ трогает UI-сессию и localStorage:
 * access-токены разных логинов живут параллельно, refresh не дёргаем —
 * ротации и разлогина UI нет, проверено живьём).
 */
async function apiTokenFor(page: Page, login: string, pin: string): Promise<string | null> {
  return await page.evaluate(
    async ([l, p]) => {
      try {
        const r = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: l, pin: p }),
        });
        if (!r.ok) return null;
        return ((await r.json()).access_token ?? null) as string | null;
      } catch {
        return null;
      }
    },
    [login, pin] as [string, string],
  );
}

/** Worker с участка areaId (бэкенд требует доступность исполнителя на участке). */
async function areaWorkerId(page: Page, areaId: string, token: string): Promise<string | null> {
  return await page.evaluate(
    async ([aid, at]) => {
      try {
        const res = await fetch('/api/v1/dict/employees', {
          headers: { Authorization: `Bearer ${at}` },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          items?: { id: string; area_ids?: string[]; role?: string }[];
        };
        const hit = (data.items ?? []).find(
          (e) => (e.role ?? 'worker') === 'worker' && (e.area_ids ?? []).includes(aid),
        );
        return hit?.id ?? null;
      } catch {
        return null;
      }
    },
    [areaId, token] as [string, string],
  );
}

/** Отмена своего наряда живьём через сниффнутый токен (cancel требует reason_code). */
async function cancelOrder(page: Page, id: string, token: string): Promise<string> {
  return await page.evaluate(
    async ([oid, at]) => {
      try {
        const res = await fetch(`/api/v1/work-orders/${oid}/transitions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'cancel',
            reason_code: 'duplicate',
            client_at: new Date().toISOString(),
          }),
        });
        return res.ok ? 'cancelled' : `cancel-failed:${res.status}`;
      } catch (e) {
        return `cleanup-error:${String(e)}`;
      }
    },
    [id, token] as [string, string],
  );
}

let createdOrderId: string | null = null;
let apiToken: string | null = null;

test.afterEach(async ({ page }, testInfo) => {
  // Страховочная отмена нашего наряда; при скипе тихо выходим.
  if (testInfo.status === 'skipped' || !createdOrderId) {
    createdOrderId = null;
    apiToken = null;
    return;
  }
  try {
    const tok = apiToken ?? (await apiTokenFor(page, 'master1', '3333').catch(() => null));
    const res = tok ? await cancelOrder(page, createdOrderId, tok) : 'no-token';
    // eslint-disable-next-line no-console
    console.log(`[cleanup] suggestions afterEach cancel ${createdOrderId}: ${res}`);
  } catch {
    /* best effort */
  } finally {
    createdOrderId = null;
    apiToken = null;
  }
});

test('live: suggestAssignee shows live candidates or stays stable', async ({ page }) => {
  await loginAsMaster(page);
  await page.goto('/master/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radiogroup', { name: 'Тип работ' })).toBeVisible({ timeout: 20000 });
  await fillAreaAndDescription(page, 'Насос шумит и течёт вторые сутки');
  const aiButton = page.getByRole('button', { name: 'Рекомендация ИИ' });
  await expect(aiButton).toBeEnabled({ timeout: 15000 });
  const aiResp = page.waitForResponse(
    (r) => r.url().includes('/ai/suggest-assignee') && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await aiButton.click();
  const resp = await aiResp;
  expect(resp.ok()).toBeTruthy();
  // Толерантно: кандидаты с «Применить» (<=3) либо стабильная форма без них.
  await expect(async () => {
    const applyCount = await page.getByRole('button', { name: 'Применить' }).count();
    const enabled = await aiButton.isEnabled().catch(() => false);
    expect(applyCount <= 3 && (applyCount > 0 || enabled)).toBeTruthy();
  }).toPass({ timeout: 20000 });
});

test('live: issuing the order works without AI and is cancelled after (cleanup)', async ({
  page,
}) => {
  await loginAsMaster(page);
  apiToken = await apiTokenFor(page, 'master1', '3333');
  test.skip(!apiToken, 'live stand: could not capture app token');
  await page.goto('/master/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radiogroup', { name: 'Тип работ' })).toBeVisible({ timeout: 20000 });
  const description = `e2e-suggest-${Date.now()} гудит насос`;
  const areaSel = page.getByLabel(/Участок/);
  await waitOptions(areaSel);
  const areaId = await selectFirstOption(areaSel);
  expect(areaId).toBeTruthy();
  await page.locator('textarea').fill(description);
  // ИИ не вызываем вообще: выдача не должна зависеть от него.
  const equipSel = page.getByLabel(/Оборудование/);
  await waitOptions(equipSel);
  expect(await selectFirstOption(equipSel)).toBeTruthy();
  await page.getByPlaceholder('дд.мм.гггг, чч:мм').fill('20.10.2027, 12:00');
  // Исполнитель обязан быть с выбранного участка — подбираем через API.
  const wid = await areaWorkerId(page, areaId as string, apiToken as string);
  const assignee = page.getByLabel(/человек или бригада/);
  if (wid) {
    const values = await assignee
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    test.skip(!values.includes(wid), 'live stand: area worker missing from /workers list');
    await assignee.selectOption(wid);
  } else {
    expect(await selectFirstOption(assignee)).toBeTruthy();
  }
  const submit = page.getByRole('button', { name: 'Новый наряд' });
  await expect(submit).toBeEnabled({ timeout: 20000 });
  await submit.click();
  await expect(page).toHaveURL(/\/master\/orders\/.+/, { timeout: 20000 });
  const match = page.url().match(/\/master\/orders\/([^/?#]+)/);
  createdOrderId = match ? match[1] : null;
  expect(createdOrderId).toBeTruthy();
  // Cleanup: отменяем только что созданный наряд.
  const res = await cancelOrder(page, createdOrderId as string, apiToken as string);
  // eslint-disable-next-line no-console
  console.log(`[cleanup] issue-order test cancel ${createdOrderId}: ${res}`);
  expect(res).toBe('cancelled');
  createdOrderId = null;
});

test('live: applying the AI candidate fills the assignee (or stable skip)', async ({ page }) => {
  await loginAsMaster(page);
  await page.goto('/master/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('radiogroup', { name: 'Тип работ' })).toBeVisible({ timeout: 20000 });
  await fillAreaAndDescription(page, 'Насос шумит и течёт вторые сутки');
  const equipSel = page.getByLabel(/Оборудование/);
  await waitOptions(equipSel);
  expect(await selectFirstOption(equipSel)).toBeTruthy();
  await page.getByPlaceholder('дд.мм.гггг, чч:мм').fill('20.10.2027, 12:00');
  const aiResp = page.waitForResponse(
    (r) => r.url().includes('/ai/suggest-assignee') && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: 'Рекомендация ИИ' }).click();
  await aiResp;
  const apply = page.getByRole('button', { name: 'Применить' }).first();
  if (await apply.isVisible().catch(() => false)) {
    await apply.click({ timeout: 15000 });
    await expect(async () => {
      const v = await page.getByLabel(/человек или бригада/).inputValue();
      expect(v).not.toBe('');
    }).toPass({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Новый наряд' })).toBeEnabled({ timeout: 15000 });
  } else {
    // Живой ИИ не вернул кандидатов — форма стабильна, выдача возможна вручную.
    await expect(page.getByRole('button', { name: 'Рекомендация ИИ' })).toBeEnabled({
      timeout: 15000,
    });
  }
});
