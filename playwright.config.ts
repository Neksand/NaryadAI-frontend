import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Песочница иногда роняет запись трейсов (ENOENT на close) — локально
    // допускается PW_TRACE=off; в CI всегда retain-on-failure для артефактов.
    trace: process.env.CI ? 'retain-on-failure' : ((process.env.PW_TRACE as 'off' | 'on' | 'retain-on-failure' | undefined) ?? 'retain-on-failure'),
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      ...process.env,
      VITE_API_URL: '/api/v1',
      VITE_WS_URL: `ws://127.0.0.1:${port}/api/ws`,
    },
  },
});
