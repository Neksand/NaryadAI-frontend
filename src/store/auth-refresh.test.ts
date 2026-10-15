import { afterEach, describe, expect, it, vi } from 'vitest';

// Ручной мок axios: перехватываем create/post/isAxiosError, handlers интерцепторов забираем.
// Без сети: refresh и ретраи проверяются на уровне перехватчиков ответа.
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

type ApiClient = typeof import('../lib/api-client');

async function load(apiUrl: string): Promise<ApiClient> {
  vi.resetModules();
  netMocks.reqHandlers.length = 0;
  netMocks.resHandlers.length = 0;
  netMocks.instance.request.mockClear();
  netMocks.axiosPost.mockReset();
  vi.stubEnv('VITE_API_URL', apiUrl);
  vi.stubEnv('VITE_WS_URL', 'ws://localhost:8080/api/ws');
  localStorage.clear();
  return await import('../lib/api-client');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const PRIMARY = 'http://srv:8080/api/v1';

const err401 = (config: Record<string, unknown>) =>
  new AxiosError('unauthorized', { config, response: { status: 401, data: {} } });

describe('auth refresh single-flight', () => {
  it('два параллельных запроса с протухшим токеном дают ровно один refresh, оба успешны', async () => {
    const mod = await load(PRIMARY);
    mod.setTokens('expired-access', 'refresh-1');
    netMocks.axiosPost.mockResolvedValueOnce({
      data: { access_token: 'fresh-access', refresh_token: 'refresh-2' },
    });
    const rej = netMocks.resHandlers[1] as (e: unknown) => Promise<unknown>;
    const firstConfig: Record<string, unknown> = { baseURL: PRIMARY, headers: {} };
    const secondConfig: Record<string, unknown> = { baseURL: PRIMARY, headers: {} };

    await Promise.all([rej(err401(firstConfig)), rej(err401(secondConfig))]);

    // WS-reconnect + повтор offline-очереди после пробуждения: гонки нет,
    // второй refresh с тем же refresh_token не уходит и сессия не отзывается.
    expect(netMocks.axiosPost).toHaveBeenCalledTimes(1);
    expect(netMocks.axiosPost).toHaveBeenCalledWith(
      `${PRIMARY}/auth/refresh`,
      { refresh_token: 'refresh-1' },
      expect.anything(),
    );
    expect(netMocks.instance.request).toHaveBeenCalledTimes(2);
    expect(
      netMocks.instance.request.mock.calls.map(
        ([cfg]) => (cfg as { headers: Record<string, string> }).headers.Authorization,
      ),
    ).toEqual(['Bearer fresh-access', 'Bearer fresh-access']);
    expect(mod.getAccessToken()).toBe('fresh-access');
    expect(mod.getRefreshToken()).toBe('refresh-2');
  });

  it('провал refresh дает ровно один logout без повторных попыток', async () => {
    const mod = await load(PRIMARY);
    const { useAuthStore } = await import('./auth-store');
    useAuthStore
      .getState()
      .setSession(
        { id: 'u1', full_name: 'U', role: 'worker', area_ids: [] },
        'expired-access',
        'refresh-1',
      );
    const originalLogout = useAuthStore.getState().logout;
    const logoutSpy = vi.fn(() => {
      originalLogout();
    });
    useAuthStore.setState({ logout: logoutSpy });
    // Сессия отозвана: refresh отклонён 401.
    netMocks.axiosPost.mockRejectedValueOnce(
      new AxiosError('session revoked', { response: { status: 401, data: {} } }),
    );
    const rej = netMocks.resHandlers[1] as (e: unknown) => Promise<unknown>;
    const firstErr = err401({ baseURL: PRIMARY, headers: {} });
    const secondErr = err401({ baseURL: PRIMARY, headers: {} });

    const results = await Promise.allSettled([rej(firstErr), rej(secondErr)]);

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(netMocks.axiosPost).toHaveBeenCalledTimes(1);
    // Ровно одно разлогинивание, без каскада; исходные запросы не повторяются.
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(netMocks.instance.request).not.toHaveBeenCalled();
    expect(mod.getAccessToken()).toBeNull();
    expect(mod.getRefreshToken()).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    useAuthStore.setState({ logout: originalLogout });
  });
});
