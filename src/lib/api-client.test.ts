import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  if (typeof localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as unknown as Record<string, unknown>)['localStorage'] = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    };
  }
});

describe('api-client uuid', () => {
  it('generates unique keys without SecureContext', async () => {
    const { newUUID } = await import('./api-client');
    const a = newUUID();
    const b = newUUID();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(4);
    expect(a).not.toBe(b);
  });

  it('idempotencyHeaders reuses provided key for retries', async () => {
    const { idempotencyHeaders, newUUID } = await import('./api-client');
    const key = newUUID();
    expect(idempotencyHeaders(key)['Idempotency-Key']).toBe(key);
    const auto = idempotencyHeaders();
    expect(typeof auto['Idempotency-Key']).toBe('string');
  });
});

describe('toLocalizedError', () => {
  it('maps network failure to network_error', async () => {
    const { toLocalizedError } = await import('./api-client');
    const { AxiosError } = await import('axios');
    const e = new AxiosError('Network Error');
    const out = toLocalizedError(e);
    expect(out.code).toBe('network_error');
    expect(out.status).toBe(0);
  });

  it('parses backend contract errors', async () => {
    const { toLocalizedError } = await import('./api-client');
    const { AxiosError } = await import('axios');
    const e = new AxiosError('x', undefined, undefined, undefined, {
      status: 423,
      data: {
        error: { code: 'account_locked', message: 'Locked', translation_key: 'error.locked' },
        request_id: 'r1',
      },
    } as never);
    const out = toLocalizedError(e);
    expect(out).toMatchObject({
      code: 'account_locked',
      message: 'Locked',
      status: 423,
      requestId: 'r1',
    });
  });

  it('falls back to FastAPI detail string', async () => {
    const { toLocalizedError } = await import('./api-client');
    const { AxiosError } = await import('axios');
    const e = new AxiosError('x', undefined, undefined, undefined, {
      status: 500,
      data: { detail: 'DB down' },
    } as never);
    expect(toLocalizedError(e)).toMatchObject({
      code: 'http_500',
      message: 'DB down',
      status: 500,
    });
  });

  it('falls back to first validation message', async () => {
    const { toLocalizedError } = await import('./api-client');
    const { AxiosError } = await import('axios');
    const e = new AxiosError('x', undefined, undefined, undefined, {
      status: 422,
      data: { detail: [{ loc: ['body', 'pin'], msg: 'String too short' }] },
    } as never);
    expect(toLocalizedError(e)).toMatchObject({
      code: 'validation_error',
      message: 'String too short',
    });
  });

  it('maps unknown errors', async () => {
    const { toLocalizedError } = await import('./api-client');
    const out = toLocalizedError(new Error('boom'));
    expect(out.code).toBe('unknown');
    expect(out.message).toBeTruthy();
  });
});

describe('token storage', () => {
  it('persists refresh token to localStorage', async () => {
    const { setTokens, getRefreshToken, getAccessToken } = await import('./api-client');
    setTokens('a1', 'r1');
    expect(getAccessToken()).toBe('a1');
    expect(getRefreshToken()).toBe('r1');
    expect(localStorage.getItem('naryadai.refresh')).toBe('r1');
    setTokens(null, null);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem('naryadai.refresh')).toBeNull();
  });

  it('keeps refresh when only access changes', async () => {
    const { setTokens, getRefreshToken } = await import('./api-client');
    setTokens('a', 'r-keep');
    setTokens('a2');
    expect(getRefreshToken()).toBe('r-keep');
    setTokens(null, null);
  });
});
