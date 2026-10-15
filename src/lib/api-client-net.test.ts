import { afterEach, describe, expect, it, vi } from 'vitest';

// Ручной мок axios: перехватываем create/post/isAxiosError, handlers интерцепторов забираем.
const netMocks = vi.hoisted(() => {
  const reqHandlers: Array<(...args: never[]) => unknown> = [];
  const resHandlers: Array<(...args: never[]) => unknown> = [];
  const instance = {
    defaults: {} as Record<string, unknown>,
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(async (cfg: unknown) => ({ data: {}, config: cfg })),
    interceptors: {
      request: {
        use: vi.fn((ful: (...args: never[]) => unknown) => {
          reqHandlers.push(ful);
        }),
      },
      response: {
        use: vi.fn((ful: (...args: never[]) => unknown, rej: (...args: never[]) => unknown) => {
          resHandlers.push(ful);
          resHandlers.push(rej);
        }),
      },
    },
  };
  const axiosPost = vi.fn();
  return { reqHandlers, resHandlers, instance, axiosPost };
});

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  class FakeAxiosError extends Error {
    code?: string;
    config?: unknown;
    request?: unknown;
    response?: { status?: number; data?: unknown };
    isAxiosError = true;
    constructor(
      message = '',
      opts: {
        code?: string;
        config?: unknown;
        response?: { status?: number; data?: unknown };
      } = {},
    ) {
      super(message);
      this.code = opts.code;
      this.config = opts.config;
      this.response = opts.response;
    }
  }
  return {
    ...actual,
    default: {
      create: () => netMocks.instance,
      post: netMocks.axiosPost,
      isAxiosError: (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError,
    },
    isAxiosError: (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError,
    AxiosError: FakeAxiosError,
  };
});

import { AxiosError } from 'axios';

type ApiClient = typeof import('./api-client');

async function load(apiUrl: string): Promise<ApiClient> {
  vi.resetModules();
  netMocks.reqHandlers.length = 0;
  netMocks.resHandlers.length = 0;
  netMocks.instance.request.mockClear();
  netMocks.axiosPost.mockReset();
  vi.stubEnv('VITE_API_URL', apiUrl);
  vi.stubEnv('VITE_WS_URL', 'ws://localhost:8080/api/ws');
  localStorage.clear();
  return await import('./api-client');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const PRIMARY = 'http://localhost:8080/api/v1';
const FALLBACK = 'http://localhost/api/v1';

describe('api bases', () => {
  it('offers :8080 -> plain fallback', async () => {
    const mod = await load(PRIMARY);
    expect(mod.PRIMARY_API_URL).toBe(PRIMARY);
    expect(mod.FALLBACK_API_URL).toBe(FALLBACK);
    expect(mod.getApiBases()).toEqual([PRIMARY, FALLBACK]);
    expect(mod.getActiveApiBase()).toBe(PRIMARY);
  });

  it('disables fallback for remote production hosts', async () => {
    const mod = await load('http://79.108.166.207/api/v1');
    expect(mod.FALLBACK_API_URL).toBeNull();
    expect(mod.getApiBases()).toEqual(['http://79.108.166.207/api/v1']);
    expect(mod.getActiveApiBase()).toBe('http://79.108.166.207/api/v1');
  });

  it('ignores a poisoned saved fallback base and heals to primary', async () => {
    localStorage.setItem('naryadai.api-base', 'http://79.108.166.207:8080/api/v1');
    const mod = await load('http://79.108.166.207/api/v1');
    expect(mod.getActiveApiBase()).toBe('http://79.108.166.207/api/v1');
  });

  it('offers plain -> :8080 fallback', async () => {
    const mod = await load('http://localhost/api/v1');
    expect(mod.FALLBACK_API_URL).toBe('http://localhost:8080/api/v1');
  });
});

describe('request interceptor', () => {
  it('attaches bearer and language', async () => {
    const mod = await load(PRIMARY);
    mod.setTokens('tok123', 'ref');
    const headers = { set: vi.fn(), get: () => null };
    await netMocks.reqHandlers[0]({ headers });
    expect(headers.set).toHaveBeenCalledWith('Authorization', 'Bearer tok123');
    expect(headers.set).toHaveBeenCalledWith('Accept-Language', expect.any(String));
  });

  it('skips auth header without token', async () => {
    const mod = await load(PRIMARY);
    mod.setTokens(null, null);
    const headers = { set: vi.fn() };
    await netMocks.reqHandlers[0]({ headers });
    expect(headers.set).toHaveBeenCalledTimes(1);
  });

  it('uses the saved Kazakh language preference on each request', async () => {
    const mod = await load(PRIMARY);
    mod.setTokens(null, null);
    localStorage.setItem('naryadai.lang', 'kk');
    const headers = { set: vi.fn() };
    await netMocks.reqHandlers[0]({ headers });
    expect(headers.set).toHaveBeenCalledWith('Accept-Language', 'kk');
  });
});

describe('network fallback interceptor', () => {
  const netErr = (config: Record<string, unknown>) => new AxiosError('no response', { config });

  it('switches to fallback base once and retries', async () => {
    const mod = await load(PRIMARY);
    mod.setTokens(null, null);
    const rej = netMocks.resHandlers[1] as (e: unknown) => Promise<unknown>;
    const config: Record<string, unknown> = { baseURL: PRIMARY, headers: {} };
    await rej(netErr(config));
    expect(config.baseURL).toBe(FALLBACK);
    expect(config._baseSwitched).toBe(true);
    expect(netMocks.instance.request).toHaveBeenCalledTimes(1);
    expect(mod.getActiveApiBase()).toBe(FALLBACK);
  });

  it('rejects after fallback already tried', async () => {
    const mod = await load(PRIMARY);
    mod.setTokens(null, null);
    const rej = netMocks.resHandlers[1] as (e: unknown) => Promise<unknown>;
    const err = netErr({ baseURL: FALLBACK, headers: {}, _baseSwitched: true });
    await expect(rej(err)).rejects.toBe(err);
    void mod;
  });

  it('does not hide an HTTP server error by switching API bases', async () => {
    const mod = await load(PRIMARY);
    const rej = netMocks.resHandlers[1] as (e: unknown) => Promise<unknown>;
    const err = new AxiosError('server failed', {
      config: { baseURL: PRIMARY },
      response: { status: 503, data: { error: { code: 'unavailable' } } },
    });

    await expect(rej(err)).rejects.toBe(err);
    expect(mod.getActiveApiBase()).toBe(PRIMARY);
    expect(netMocks.instance.request).not.toHaveBeenCalled();
  });
});

describe('401 refresh interceptor', () => {
  const err401 = (config: Record<string, unknown>) =>
    new AxiosError('unauthorized', { config, response: { status: 401, data: {} } });

  it('refreshes token and retries with new bearer', async () => {
    const mod = await load(PRIMARY);
    mod.setTokens('old', 'ref-1');
    netMocks.axiosPost.mockResolvedValueOnce({
      data: { access_token: 'new', refresh_token: 'newR' },
    });
    const rej = netMocks.resHandlers[1] as (e: unknown) => Promise<unknown>;
    const config: Record<string, unknown> = {
      baseURL: PRIMARY,
      headers: {} as Record<string, unknown>,
    };
    await rej(err401(config));
    expect(netMocks.axiosPost).toHaveBeenCalledWith(
      `${PRIMARY}/auth/refresh`,
      { refresh_token: 'ref-1' },
      expect.anything(),
    );
    expect(mod.getAccessToken()).toBe('new');
    expect(mod.getRefreshToken()).toBe('newR');
    const retried = netMocks.instance.request.mock.calls[0][0] as Record<string, unknown>;
    expect((retried.headers as Record<string, string>).Authorization).toBe('Bearer new');
  });

  it('coalesces concurrent 401 responses into one refresh request', async () => {
    const mod = await load(PRIMARY);
    mod.setTokens('old', 'refresh-1');
    netMocks.axiosPost.mockResolvedValueOnce({
      data: { access_token: 'fresh', refresh_token: 'refresh-2' },
    });
    const rej = netMocks.resHandlers[1] as (e: unknown) => Promise<unknown>;
    const firstConfig: Record<string, unknown> = { baseURL: PRIMARY, headers: {} };
    const secondConfig: Record<string, unknown> = { baseURL: PRIMARY, headers: {} };

    await Promise.all([rej(err401(firstConfig)), rej(err401(secondConfig))]);

    expect(netMocks.axiosPost).toHaveBeenCalledTimes(1);
    expect(netMocks.instance.request).toHaveBeenCalledTimes(2);
    expect(
      netMocks.instance.request.mock.calls.map(
        ([cfg]) => (cfg as { headers: Record<string, string> }).headers.Authorization,
      ),
    ).toEqual(['Bearer fresh', 'Bearer fresh']);
    expect(mod.getRefreshToken()).toBe('refresh-2');
  });

  it('retries refresh against the fallback base after a network failure', async () => {
    const mod = await load(PRIMARY);
    mod.setTokens('old', 'refresh-1');
    netMocks.axiosPost
      .mockRejectedValueOnce(new AxiosError('network unavailable'))
      .mockResolvedValueOnce({ data: { access_token: 'fresh', refresh_token: 'refresh-2' } });

    await expect(mod.refreshSession()).resolves.toBe('fresh');

    expect(netMocks.axiosPost).toHaveBeenNthCalledWith(
      1,
      `${PRIMARY}/auth/refresh`,
      expect.anything(),
      expect.anything(),
    );
    expect(netMocks.axiosPost).toHaveBeenNthCalledWith(
      2,
      `${FALLBACK}/auth/refresh`,
      expect.anything(),
      expect.anything(),
    );
    expect(mod.getActiveApiBase()).toBe(FALLBACK);
    expect(localStorage.getItem('naryadai.api-base')).toBeNull();
  });

  it('failed refresh clears session and rejects', async () => {
    const mod = await load(PRIMARY);
    const { useAuthStore } = await import('../store/auth-store');
    useAuthStore
      .getState()
      .setSession({ id: 'u', full_name: 'U', role: 'worker', area_ids: [] }, 'old', 'ref-1');
    netMocks.axiosPost.mockRejectedValueOnce(
      new AxiosError('refresh rejected', {
        response: { status: 401, data: {} },
      }),
    );
    const rej = netMocks.resHandlers[1] as (e: unknown) => Promise<unknown>;
    const err = err401({ baseURL: PRIMARY, headers: {} });
    await expect(rej(err)).rejects.toBe(err);
    expect(mod.getAccessToken()).toBeNull();
    expect(mod.getRefreshToken()).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('keeps the refresh credential and cached identity through a network outage', async () => {
    const mod = await load(PRIMARY);
    const { useAuthStore } = await import('../store/auth-store');
    useAuthStore
      .getState()
      .setSession({ id: 'u', full_name: 'U', role: 'worker', area_ids: [] }, 'old', 'ref-1');
    netMocks.axiosPost.mockRejectedValue(new AxiosError('network unavailable'));

    await expect(mod.refreshSession()).resolves.toBeNull();

    expect(mod.getAccessToken()).toBeNull();
    expect(mod.getRefreshToken()).toBe('ref-1');
    expect(localStorage.getItem('naryadai.refresh')).toBe('ref-1');
    expect(useAuthStore.getState().user?.id).toBe('u');
  });

  it('does not restore tokens if a pending refresh completes after logout', async () => {
    const mod = await load(PRIMARY);
    const { useAuthStore } = await import('../store/auth-store');
    useAuthStore
      .getState()
      .setSession({ id: 'u', full_name: 'U', role: 'worker', area_ids: [] }, 'old', 'ref-1');
    let finish!: (value: unknown) => void;
    netMocks.axiosPost.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = mod.refreshSession();
    useAuthStore.getState().logout();
    finish({ data: { access_token: 'late-access', refresh_token: 'late-refresh' } });
    await expect(pending).resolves.toBeNull();
    expect(mod.getAccessToken()).toBeNull();
    expect(mod.getRefreshToken()).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('does not log a new account out when an old refresh is rejected', async () => {
    const mod = await load(PRIMARY);
    const { useAuthStore } = await import('../store/auth-store');
    const user = (id: string) => ({ id, full_name: id, role: 'worker' as const, area_ids: [] });
    useAuthStore.getState().setSession(user('a'), 'old-a', 'refresh-a');
    let reject!: (error: unknown) => void;
    netMocks.axiosPost.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const pending = mod.refreshSession();
    useAuthStore.getState().setSession(user('b'), 'access-b', 'refresh-b');
    reject(new AxiosError('old refresh rejected', { response: { status: 401, data: {} } }));
    await expect(pending).resolves.toBeNull();
    expect(mod.getAccessToken()).toBe('access-b');
    expect(mod.getRefreshToken()).toBe('refresh-b');
    expect(useAuthStore.getState().user?.id).toBe('b');
  });

  it('passes through non-401 errors', async () => {
    await load(PRIMARY);
    const rej = netMocks.resHandlers[1] as (e: unknown) => Promise<unknown>;
    const err = new AxiosError('forbidden', { config: {}, response: { status: 403, data: {} } });
    await expect(rej(err)).rejects.toBe(err);
    expect(netMocks.axiosPost).not.toHaveBeenCalled();
  });

  it('does not start a second refresh when the original request already retried', async () => {
    await load(PRIMARY);
    const rej = netMocks.resHandlers[1] as (e: unknown) => Promise<unknown>;
    const err = err401({ baseURL: PRIMARY, headers: {}, _retried: true });

    await expect(rej(err)).rejects.toBe(err);
    expect(netMocks.axiosPost).not.toHaveBeenCalled();
    expect(netMocks.instance.request).not.toHaveBeenCalled();
  });
});
