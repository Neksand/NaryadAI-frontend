import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { requireLiveApi } from './live-api';

// Real browser + API + database. Every mutation goes through the UI; API reads
// only identify catalog records and verify persisted evidence. No route mocks.
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

async function login(page: Page, username: string, pin: string) {
  await page.goto('/login');
  await page.locator('form input').nth(0).fill(username);
  await page.locator('form input').nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });
}

function dueInput() {
  const date = new Date(Date.now() + 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()}, ${p(date.getHours())}:${p(date.getMinutes())}`;
}

test('case: master issues, worker accepts and completes with materials, master reviews', async ({
  browser,
  request,
}, testInfo) => {
  await requireLiveApi(request);
  const masterContext = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    viewport: { width: 1280, height: 800 },
    locale: 'ru-RU',
  });
  const workerContext = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
  });
  const master = await masterContext.newPage();
  const worker = await workerContext.newPage();
  const startedAt = Date.now();
  const frames: { side: string; type: string; id?: string; at: number }[] = [];
  for (const [side, page] of [
    ['master', master],
    ['worker', worker],
  ] as const) {
    page.on('websocket', (socket) =>
      socket.on('framereceived', (frame) => {
        try {
          const data = JSON.parse(String(frame.payload));
          frames.push({
            side,
            type: data.type ?? data.event,
            id: data.payload?.id,
            at: Date.now(),
          });
        } catch {
          /* not a JSON business frame */
        }
      }),
    );
  }
  const consoleErrors: string[] = [];
  master.on('pageerror', (error) => consoleErrors.push(error.message));
  worker.on('pageerror', (error) => consoleErrors.push(error.message));
  try {
    await login(master, 'master1', '3333');
    await login(worker, 'worker01', '1001');
    const tokenResponse = await request.post('/api/v1/auth/login', {
      data: { login: 'master1', pin: '3333' },
    });
    expect(tokenResponse.status()).toBe(200);
    const token = (await tokenResponse.json()).access_token;
    const headers = { Authorization: `Bearer ${token}` };
    const workersResponse = await request.get('/api/v1/workers', { headers });
    expect(workersResponse.status()).toBe(200);
    const workerBody = await workersResponse.json();
    const workerId = (
      Array.isArray(workerBody) ? workerBody : (workerBody.items ?? workerBody.data)
    ).find((item: { login: string }) => item.login === 'worker01')?.id;
    expect(workerId).toBeTruthy();

    await master.goto('/master/new');
    const creationStartedAt = Date.now();
    const creationActions: { type: string; field: string }[] = [];
    await master.getByRole('radio', { name: 'Внеплановый', exact: true }).click();
    creationActions.push({ type: 'click', field: 'kind' });
    await master.getByLabel(/Участок/).selectOption({ index: 1 });
    creationActions.push({ type: 'select', field: 'area' });
    const equipment = master.getByLabel(/Оборудование/);
    await expect.poll(() => equipment.locator('option').count()).toBeGreaterThan(1);
    await equipment.selectOption({ index: 1 });
    creationActions.push({ type: 'select', field: 'equipment' });
    await master.getByPlaceholder('дд.мм.гггг, чч:мм').fill(dueInput());
    creationActions.push({ type: 'fill', field: 'due_at' });
    const description = `Проверить подшипник и заменить масло — synthetic e2e ${Date.now()}`;
    await master.locator('textarea').fill(description);
    creationActions.push({ type: 'fill', field: 'description' });
    await master.getByLabel(/человек или бригада/).selectOption(workerId);
    creationActions.push({ type: 'select', field: 'assignee' });
    // Synthetic fixtures exercise real compression/upload/storage, not visual repair quality.
    const beforePhoto = await sharp({
      create: { width: 320, height: 240, channels: 3, background: '#bd5828' },
    })
      .png()
      .toBuffer();
    const afterPhoto = await sharp({
      create: { width: 320, height: 240, channels: 3, background: '#276a51' },
    })
      .png()
      .toBuffer();
    const uploadedBefore = master.waitForResponse(
      (response) => response.url().endsWith('/photos') && response.request().method() === 'POST',
    );
    await master
      .locator('input[type="file"]')
      .setInputFiles({ name: 'synthetic-before.png', mimeType: 'image/png', buffer: beforePhoto });
    creationActions.push({ type: 'fileUpload', field: 'before_photo' });
    expect((await uploadedBefore).status()).toBe(200);
    const createdResponse = master.waitForResponse(
      (response) =>
        response.url().endsWith('/work-orders') && response.request().method() === 'POST',
    );
    await master.getByRole('button', { name: 'Новый наряд' }).click();
    creationActions.push({ type: 'click', field: 'submit' });
    const created = await createdResponse;
    expect([200, 201]).toContain(created.status());
    const orderId = (await created.json()).id;
    const automatedCreationMs = Date.now() - creationStartedAt;
    await expect(master).toHaveURL(new RegExp(`/master/orders/${orderId}$`));
    await worker.goto(`/worker/orders/${orderId}`);
    await worker.setViewportSize({ width: 320, height: 844 });
    await expect(
      worker.getByRole('button', { name: 'Принять в работу', exact: true }),
    ).toBeVisible();
    expect((await worker.locator('header b').boundingBox())?.width).toBeGreaterThan(240);
    for (const name of ['Назад', 'Выйти']) {
      expect(
        (await worker.getByRole('button', { name, exact: true }).boundingBox())?.height,
      ).toBeGreaterThanOrEqual(44);
    }
    expect(
      await worker.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await worker.screenshot({ path: testInfo.outputPath('worker-320.png') });
    await worker.setViewportSize({ width: 390, height: 844 });
    await expect(master.locator('.conn')).toHaveAttribute('title', 'open');
    await expect(worker.locator('.conn')).toHaveAttribute('title', 'open');
    const realtimeStarted = Date.now();
    await worker.getByRole('button', { name: 'Принять в работу', exact: true }).click();
    await expect(master.getByText('Принят', { exact: true })).toBeVisible({ timeout: 5000 });
    const realtimeMs = Date.now() - realtimeStarted;
    await worker.getByRole('button', { name: 'Начать', exact: true }).click();
    await worker.getByRole('button', { name: 'Завершить', exact: true }).click();
    const dialog = worker.getByRole('dialog', { name: 'Завершение наряда' });
    await dialog
      .getByLabel(/Что сделано/)
      .fill('Проверил подшипник и заменил масло, проверил герметичность.');
    const fault = dialog.getByLabel(/Шифр неисправности/);
    await expect.poll(() => fault.locator('option').count()).toBeGreaterThan(1);
    await fault.selectOption({ index: 1 });
    await dialog.getByRole('button', { name: 'Добавить материал' }).click();
    console.info('UI step: completion form and material row ready');
    await dialog.getByLabel(/Материал 1/).selectOption({ index: 1 });
    const materialId = await dialog.getByLabel(/Материал 1/).inputValue();
    await dialog.getByLabel(/Количество 1/).fill('2.5');
    await dialog
      .getByLabel('Комментарий (необязательно)')
      .fill('Синтетический тест сквозного сценария');
    const uploadedAfter = worker.waitForResponse(
      (response) =>
        response.url().endsWith(`/work-orders/${orderId}/photos`) &&
        response.request().method() === 'POST',
    );
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: 'synthetic-after.png', mimeType: 'image/png', buffer: afterPhoto });
    expect((await uploadedAfter).status()).toBe(200);
    await expect(dialog).toBeVisible();
    expect(
      await worker.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await dialog.evaluate((element) => {
      element.scrollTop = 0;
    });
    await worker.screenshot({
      path: testInfo.outputPath('worker-completion-mobile.png'),
      fullPage: false,
    });
    await dialog.getByRole('button', { name: 'Завершить', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(worker.getByText('Проверка ИИ', { exact: true })).toBeVisible();

    console.info('UI step: completion persisted, opening master review');
    await master.goto(`/master/review/${orderId}`);
    // The real background worker must finish; a pending UI is not a passing test.
    // Synthetic images cannot prove visual repair quality. A human decides explicitly.
    await master.getByLabel('Оценка мастера (0–100)').fill('85');
    await master
      .getByLabel('Комментарий', { exact: true })
      .fill('Результат проверен мастером на тестовом стенде');
    const manual = master.getByRole('button', { name: 'Принять со своей оценкой' });
    await expect(manual).toBeEnabled({ timeout: 60_000 });
    const decisionResponse = master.waitForResponse(
      (response) =>
        response.url().endsWith('/review/decision') && response.request().method() === 'POST',
    );
    await manual.click();
    expect((await decisionResponse).status()).toBe(200);
    const expectedStatus = 'closed';
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/v1/work-orders/${orderId}`, { headers })).json()).status,
      )
      .toBe(expectedStatus);
    const reportResponse = await request.get(
      `/api/v1/work-orders/${orderId}/report?audience=master`,
      { headers },
    );
    expect(reportResponse.status()).toBe(200);
    const report = await reportResponse.json();
    expect(report.events.map((event: { action: string }) => event.action)).toEqual(
      expect.arrayContaining(['issued', 'accept', 'start', 'complete']),
    );
    const completion = report.events.find(
      (event: { action: string }) => event.action === 'complete',
    );
    expect(completion.comment).toBe('Синтетический тест сквозного сценария');
    expect(report.order.photos.map((photo: { kind: string }) => photo.kind)).toEqual(
      expect.arrayContaining(['before', 'after']),
    );
    expect(report.order.materials).toEqual(
      expect.arrayContaining([expect.objectContaining({ material_id: materialId, quantity: 2.5 })]),
    );
    await expect(worker.getByText('Закрыт', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(worker.getByText('85 / 100', { exact: true })).toBeVisible();
    expect(consoleErrors).toEqual([]);
    const metrics = {
      durationMs: Date.now() - startedAt,
      realtimeMs,
      orderId,
      finalStatus: expectedStatus,
      automatedCreationMs,
      creationActionCount: creationActions.length,
      creationActions,
      creationCountDefinition:
        'Automated form actions: one click, selectOption, fill or setInputFiles = one action. Login/navigation, keyboard keystrokes and native file-picker taps excluded. Not a human six-tap/time study.',
    };
    await writeFile(testInfo.outputPath('case-metrics.json'), JSON.stringify(metrics, null, 2));
    await writeFile(
      new URL('../docs/evidence/creation-metrics.json', import.meta.url),
      JSON.stringify({ actions: creationActions, automatedCreationMs }, null, 2),
    );
    console.info('Case metrics:', JSON.stringify(metrics));
    await master.screenshot({ path: testInfo.outputPath('master-decision.png'), fullPage: true });
    await testInfo.attach('case-metrics', {
      body: JSON.stringify(metrics, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await testInfo.attach('sanitized-ws-events', {
      body: JSON.stringify(frames, null, 2),
      contentType: 'application/json',
    });
    await worker
      .screenshot({ path: testInfo.outputPath('worker-final.png'), fullPage: true })
      .catch(() => undefined);
    await masterContext.close().catch(() => undefined);
    await workerContext.close().catch(() => undefined);
  }
});
