import { expect, test, type Page, type Route } from '@playwright/test';

const OFFLINE_KEY = 'e2e-photo-offline';

const masterUser = {
  id: 'master-photo-e2e',
  login: 'master-photo-e2e',
  full_name: 'Мастер E2E',
  role: 'master',
  area_ids: ['area-photo-e2e'],
};

type CreateBody = {
  photo_ids?: string[];
  description?: string;
  equipment_id?: string;
  assignee_id?: string;
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installApiFixtures(page: Page, events: string[], created: CreateBody[]) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    if (path === '/auth/login' && request.method() === 'POST') {
      await fulfillJson(route, {
        access_token: 'e2e-access',
        refresh_token: 'e2e-refresh',
        user: masterUser,
      });
      return;
    }
    if (path === '/auth/refresh' && request.method() === 'POST') {
      await fulfillJson(route, {
        access_token: 'e2e-access-after-reload',
        refresh_token: 'e2e-refresh',
      });
      return;
    }
    if (path === '/me' && request.method() === 'GET') {
      await fulfillJson(route, masterUser);
      return;
    }
    if (path === '/sites' && request.method() === 'GET') {
      await fulfillJson(route, {
        data: [{ id: 'area-photo-e2e', name: 'Участок E2E' }],
      });
      return;
    }
    if (path === '/equipment' && request.method() === 'GET') {
      await fulfillJson(route, {
        data: [{ id: 'equipment-photo-e2e', name: 'Насос E2E', area_id: 'area-photo-e2e' }],
      });
      return;
    }
    if (path === '/teams' && request.method() === 'GET') {
      await fulfillJson(route, { data: [] });
      return;
    }
    if (path === '/workers' && request.method() === 'GET') {
      await fulfillJson(route, {
        data: [{ id: 'worker-photo-e2e', full_name: 'Исполнитель E2E' }],
      });
      return;
    }
    if (/^\/equipment\/[^/]+\/similar-repairs$/.test(path) && request.method() === 'GET') {
      await fulfillJson(route, []);
      return;
    }
    if (path === '/photos' && request.method() === 'POST') {
      events.push('photo-upload');
      await fulfillJson(route, { id: 'photo-uploaded-e2e' });
      return;
    }
    if (path === '/work-orders' && request.method() === 'POST') {
      const body = request.postDataJSON() as CreateBody;
      created.push(body);
      events.push('work-order-create');
      await fulfillJson(route, { id: 'created-order-e2e', status: 'issued' });
      return;
    }

    await fulfillJson(route, []);
  });
}

async function createJpeg(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no-2d-context');
    context.fillStyle = '#759c85';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#263746';
    context.fillRect(8, 8, 32, 32);
    return canvas.toDataURL('image/jpeg', 0.92);
  });
  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('canvas did not create a JPEG');
  return Buffer.from(base64, 'base64');
}

async function loginAsMockMaster(page: Page) {
  await page.goto('/login');
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('master-photo-e2e');
  await inputs.nth(1).fill('3333');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/master$/);
}

async function fillNewOrderForm(page: Page) {
  await page.getByLabel(/Участок/).selectOption('area-photo-e2e');
  await page.getByLabel(/Оборудование/).selectOption('equipment-photo-e2e');
  await page.getByLabel(/Исполнитель/).selectOption('worker-photo-e2e');
  await page.getByLabel('Название').fill('Проверка сохранения фото до создания наряда');

  const due = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const p2 = (value: number) => String(value).padStart(2, '0');
  const dueText = `${p2(due.getDate())}.${p2(due.getMonth() + 1)}.${due.getFullYear()}, ${p2(due.getHours())}:${p2(due.getMinutes())}`;
  await page.getByLabel('Срок').fill(dueText);
}

test('offline staged before-photo survives reload, then uploads before online order creation', async ({
  page,
}) => {
  const events: string[] = [];
  const created: CreateBody[] = [];
  await installApiFixtures(page, events, created);
  await page.addInitScript((offlineKey) => {
    localStorage.setItem('naryadai.lang', 'ru');
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => sessionStorage.getItem(offlineKey) !== '1',
    });
  }, OFFLINE_KEY);

  await loginAsMockMaster(page);
  await page.goto('/master/new');
  await expect(page.getByRole('option', { name: 'Участок E2E' })).toBeAttached();

  const picker = page.getByLabel('Выбрать фото');
  // The browser exposes a generic image picker here; it does not expose whether
  // a selected item came from a gallery, camera roll, or a particular disk.
  await expect(picker).toHaveAttribute('accept', 'image/*');
  await expect(picker).not.toHaveAttribute('capture');

  await page.evaluate((offlineKey) => {
    sessionStorage.setItem(offlineKey, '1');
    window.dispatchEvent(new Event('offline'));
  }, OFFLINE_KEY);
  const jpeg = await createJpeg(page);
  await picker.setInputFiles({ name: 'before-offline.jpg', mimeType: 'image/jpeg', buffer: jpeg });

  await expect(page.getByText('Фото 1 из 5')).toBeVisible();
  const originalPreview = page.locator('[data-testid^="photo-preview-"]');
  await expect(originalPreview).toHaveCount(1);
  await expect(originalPreview.locator('img')).toBeVisible();
  const previewTestId = await originalPreview.getAttribute('data-testid');
  expect(previewTestId).toBeTruthy();

  // Keep the test browser network available so the local app can reload, while
  // the app itself sees navigator.onLine=false through the scoped test shim.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Выбрать фото')).toBeVisible();
  await expect(page.getByText('Фото 1 из 5')).toBeVisible();
  const restoredPreview = page.getByTestId(previewTestId as string);
  await expect(restoredPreview).toBeVisible();
  await expect(restoredPreview.locator('img')).toBeVisible();

  await fillNewOrderForm(page);
  await expect(page.getByRole('button', { name: 'Новый наряд', exact: true })).toBeEnabled();

  // Reconnect before submit: the staged photo must still be uploaded and linked
  // to the create request instead of silently disappearing from the draft.
  await page.evaluate((offlineKey) => {
    sessionStorage.removeItem(offlineKey);
    window.dispatchEvent(new Event('online'));
  }, OFFLINE_KEY);
  await page.getByRole('button', { name: 'Новый наряд', exact: true }).click();

  await expect.poll(() => events).toEqual(['photo-upload', 'work-order-create']);
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    description: 'Проверка сохранения фото до создания наряда',
    equipment_id: 'equipment-photo-e2e',
    assignee_id: 'worker-photo-e2e',
    photo_ids: ['photo-uploaded-e2e'],
  });
});
