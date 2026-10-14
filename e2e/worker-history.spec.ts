import { expect, test, type Page } from '@playwright/test';

// Live-версия против реального API http://127.0.0.1:8080 (через vite /api proxy).
// История живая (seed worker01), толерантно: без привязки к конкретному №.

async function gotoLogin(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('naryadai.refresh');
    localStorage.removeItem('naryadai.cached-user.v1');
    localStorage.setItem('naryadai.lang', 'ru');
  });
  await page.goto('/login');
  // Живой API за vite-прокси: любой HTTP-ответ от /api/v1/* (включая 401) = стенд поднят.
  const live = await page
    .evaluate(async () => {
      try {
        const _liveRes = await fetch('/api/v1/me', { method: 'GET' });
        return _liveRes.status < 500;
      } catch {
        return false;
      }
    })
    .catch(() => false);
  test.skip(!live, 'no live API stand — run backend e2e_stand + uvicorn first');
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible({ timeout: 15000 });
}

async function fillLoginForm(page: Page, login: string, pin: string) {
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(login);
  await inputs.nth(1).fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
}

async function loginAsWorker(page: Page) {
  await gotoLogin(page);
  await fillLoginForm(page, 'worker01', '1001');
  await expect(page).toHaveURL(/\/worker/, { timeout: 20000 });
}

// Живая история: секция «Завершённые» есть всегда; внутри — либо карточки-ссылки
// (OrderCard — это <Link>, не <article>), либо «Пока пусто».
async function expectDoneSection(page: Page) {
  const done = page.locator('section[aria-label="Завершённые"]');
  await expect(done.getByRole('heading', { name: 'Завершённые' })).toBeVisible({ timeout: 20000 });
  await expect(
    done.locator('a[href*="/worker/orders/"]').first().or(done.getByText('Пока пусто')),
  ).toBeVisible({ timeout: 20000 });
}

test('live: worker home shows completed section with live history', async ({ page }) => {
  await loginAsWorker(page);
  await expect(page.getByText('Завершённые').first()).toBeVisible({ timeout: 20000 });
  await expectDoneSection(page);
});

test('live: worker history route renders', async ({ page }) => {
  await loginAsWorker(page);
  // SPA-переход по таббар-ссылке: page.goto перезагрузил бы документ и guard стёр бы refresh.
  await page.locator('nav a[href="/worker/history"]').click();
  await expect(page).toHaveURL(/\/worker\/history/, { timeout: 20000 });
  await expect(page.getByText('Завершённые').first()).toBeVisible({ timeout: 20000 });
  await expectDoneSection(page);
});
