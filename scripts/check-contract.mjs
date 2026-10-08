// Safe read-only contract check: health + openapi path inventory. No credentials, no mutations.
const base = process.env.CHECK_BASE ?? 'http://79.108.160.125:8080';

const mustHave = [
  '/api/v1/auth/login', '/api/v1/me', '/api/v1/work-orders',
  '/api/v1/work-orders/my/active', '/api/v1/work-orders/{order_id}/transitions',
  '/api/v1/work-orders/{order_id}/accept', '/api/v1/work-orders/{order_id}/complete',
  '/api/v1/work-orders/{order_id}/review/decision', '/api/v1/shift/board',
  '/api/v1/ai/suggest-assignee', '/api/v1/ai/work-orders/{oid}/inspect',
  '/api/v1/notifications', '/api/v1/analytics/dashboard', '/api/v1/dict/{ctype}',
];

const r = await fetch(`${base}/health`);
console.log('health:', r.status, await r.text());
const openapi = await (await fetch(`${base}/openapi.json`)).json();
const paths = Object.keys(openapi.paths);
console.log('openapi:', openapi.openapi, '| paths:', paths.length);
const missing = mustHave.filter((p) => !paths.includes(p));
if (missing.length) { console.error('MISSING:', missing); process.exit(1); }
console.log('contract OK — all', mustHave.length, 'required paths present');
