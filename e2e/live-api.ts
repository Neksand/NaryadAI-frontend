import { test, type APIRequestContext } from '@playwright/test';

// CI-guard for request-only helpers (fixture `request`), mirroring gotoLogin()'s
// page guard: while the backend stand is down the vite dev-server /api proxy
// answers 502/504, so any HTTP answer < 500 means the stand is up (401/403
// included). Helpers that call the API BEFORE gotoLogin() must use this first,
// otherwise they fail in CI instead of skipping.
export async function requireLiveApi(request: APIRequestContext): Promise<void> {
  let live = false;
  for (let i = 0; i < 4 && !live; i++) {
    try {
      const res = await request.get('/api/v1/me', {
        timeout: 8000,
        failOnStatusCode: false,
      });
      live = res.status() < 500;
    } catch {
      // network error / timeout — retry, the dev-server may be warming up
    }
    if (!live) await new Promise((r) => setTimeout(r, 1000));
  }
  test.skip(!live, 'no live API stand — run backend e2e_stand + uvicorn first');
}
