import { expect, test } from '@playwright/test';

for (const width of [320, 390, 768, 1280]) {
  test(`login is usable at ${width}px without horizontal scrolling`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/login');
    const signIn = page.getByRole('button', { name: 'Войти', exact: true });
    await expect(signIn).toBeVisible();
    const bounds = await signIn.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.locator('form input').first().fill('worker01');
    await page.locator('form input').nth(1).fill('1001');
    await expect(page.locator('form input').nth(1)).toHaveAttribute('type', 'password');
    await expect(signIn).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`), fullPage: true });
  });
}
