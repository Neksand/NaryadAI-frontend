import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { requireLiveApi } from './live-api';

test.setTimeout(120_000);

async function login(page: Page, username: string, pin: string) {
  await page.addInitScript(() => {
    localStorage.removeItem('naryadai.refresh');
    localStorage.removeItem('naryadai.cached-user.v1');
    localStorage.setItem('naryadai.lang', 'ru');
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(username);
  await inputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });
}

async function workerId(request: APIRequestContext): Promise<string> {
  const auth = await request.post('/api/v1/auth/login', {
    data: { login: 'master1', pin: '3333' },
  });
  expect(auth.status()).toBe(200);
  const token = (await auth.json()).access_token as string;
  const response = await request.get('/api/v1/workers', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  const workers = Array.isArray(body) ? body : (body.items ?? body.data ?? []);
  const worker = workers.find((item: { login?: string }) => item.login === 'worker01');
  expect(worker?.id).toBeTruthy();
  return worker.id as string;
}

function dueInput(): string {
  const date = new Date(Date.now() + 3_600_000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test('live: master notification showcase in Russian and Kazakh', async ({
  browser,
  request,
}, testInfo) => {
  await requireLiveApi(request);

  const baseURL = String(testInfo.project.use.baseURL);
  const masterContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
  });
  const workerContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
  });
  const master = await masterContext.newPage();
  const worker = await workerContext.newPage();

  try {
    await login(master, 'master1', '3333');
    await login(worker, 'worker01', '1001');

    await master.goto('/master/new', { waitUntil: 'domcontentloaded' });
    await master.getByRole('radio', { name: 'Внеплановый', exact: true }).click();
    await master.getByLabel(/Участок/).selectOption({ index: 1 });
    const equipment = master.getByLabel(/Оборудование/);
    await expect
      .poll(() => equipment.locator('option').count(), { timeout: 20_000 })
      .toBeGreaterThan(1);
    await equipment.selectOption({ index: 1 });
    await master.getByPlaceholder('дд.мм.гггг, чч:мм').fill(dueInput());
    await master
      .locator('textarea')
      .fill(`Проверить подшипник — notifications showcase ${Date.now()}`);
    await master.getByLabel(/человек или бригада/).selectOption(await workerId(request));

    const createdResponse = master.waitForResponse(
      (response) =>
        response.url().endsWith('/work-orders') && response.request().method() === 'POST',
    );
    await master.getByRole('button', { name: 'Новый наряд', exact: true }).click();
    const created = await createdResponse;
    expect([200, 201]).toContain(created.status());
    const orderId = (await created.json()).id as string;
    expect(orderId).toBeTruthy();

    await worker.goto(`/worker/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
    const accept = worker.getByRole('button', { name: 'Принять в работу', exact: true });
    await expect(accept).toBeVisible({ timeout: 20_000 });
    await accept.click();
    await expect(worker.getByText('Принят', { exact: true })).toBeVisible({ timeout: 20_000 });

    await master.goto('/notifications', { waitUntil: 'domcontentloaded' });
    const orderHref = `/master/orders/${orderId}`;
    const acceptedNotification = master
      .locator(`a.card[href="${orderHref}"]`)
      .filter({ hasText: 'Наряд принят' });
    await expect(acceptedNotification).toBeVisible({ timeout: 20_000 });
    const russianText = await acceptedNotification.innerText();
    expect(russianText).not.toMatch(/\b(verdict|reason)\b/i);
    await master.screenshot({
      path: testInfo.outputPath('notifications-showcase-ru.png'),
      fullPage: true,
    });

    await master.getByRole('combobox', { name: 'language / тіл' }).selectOption('kk');
    await expect(master.getByRole('combobox', { name: 'language / тіл' })).toHaveValue('kk');
    await expect(master.locator('header b')).toHaveText('Хабарламалар', { timeout: 15_000 });

    const start = worker.getByRole('button', { name: 'Начать', exact: true });
    await expect(start).toBeVisible({ timeout: 20_000 });
    await start.click();
    await expect(worker.getByText('В работе', { exact: true })).toBeVisible({ timeout: 20_000 });

    // Reopen the inbox after the worker action so it fetches the newly created notification
    // with the master's selected Kazakh locale.
    await master.goto('/master', { waitUntil: 'domcontentloaded' });
    await master.goto('/notifications', { waitUntil: 'domcontentloaded' });
    const startedNotification = master
      .locator(`a.card[href="${orderHref}"]`)
      .filter({ hasText: 'Жұмыс басталды' });
    await expect(startedNotification).toBeVisible({ timeout: 20_000 });
    const kazakhText = await startedNotification.innerText();
    expect(kazakhText).not.toMatch(/\b(verdict|reason)\b/i);

    const relativeTime = startedNotification.locator('time');
    await expect(relativeTime).toBeVisible();
    await expect(relativeTime).toContainText(/қазір|мин бұрын|сағ бұрын|күн бұрын/);
    await expect(startedNotification).toHaveAttribute('href', orderHref);
    await master.screenshot({
      path: testInfo.outputPath('notifications-showcase-kk.png'),
      fullPage: true,
    });
  } finally {
    await Promise.all([masterContext.close(), workerContext.close()]);
  }
});
