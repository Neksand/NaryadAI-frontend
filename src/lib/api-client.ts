import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import i18n from '../i18n/config';
import { API_URL as ENV_API_URL, isLoopbackApi } from './env';
import { ApiErrorSchema } from '../types/domain';

/** Совместимость: старый импорт API_URL отдаёт первичную базу. */
export const API_URL = ENV_API_URL;

/** Запасной URL: если nginx на :80 молчит — бьём напрямую в :8080, и наоборот. */
function alternateBase(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.port === '8080') {
      u.port = '';
      return u.toString().replace(/\/$/, '');
    }
    if (!u.port || u.port === '80') {
      u.port = '8080';
      return u.toString().replace(/\/$/, '');
    }
    return null;
  } catch {
    return null;
  }
}

export const PRIMARY_API_URL = ENV_API_URL;
// In local development, :80 is not a useful fallback for the backend on :8080.
// It could be persisted after startup and make later launches miss the live API.
export const FALLBACK_API_URL =
  import.meta.env.DEV && isLoopbackApi(ENV_API_URL) ? null : alternateBase(ENV_API_URL);

const BASE_KEY = 'naryadai.api-base';
let activeBase: string = PRIMARY_API_URL;
try {
  const saved = localStorage.getItem(BASE_KEY);
  if (saved && (saved === PRIMARY_API_URL || saved === FALLBACK_API_URL)) activeBase = saved;
} catch {
  /* ignore */
}

export function getActiveApiBase(): string {
  return activeBase;
}
export function getApiBases(): string[] {
  return FALLBACK_API_URL && FALLBACK_API_URL !== PRIMARY_API_URL
    ? [PRIMARY_API_URL, FALLBACK_API_URL]
    : [PRIMARY_API_URL];
}

function setActiveBase(url: string) {
  activeBase = url;
  api.defaults.baseURL = url;
  try {
    localStorage.setItem(BASE_KEY, url);
  } catch {
    /* ignore */
  }
}

export const api = axios.create({ baseURL: activeBase, timeout: 20000 });

let accessToken: string | null = null;
let refreshToken: string | null = localStorage.getItem('naryadai.refresh');
let refreshPromise: Promise<string | null> | null = null;

export function setTokens(access: string | null, refresh?: string | null) {
  accessToken = access;
  if (refresh !== undefined) {
    refreshToken = refresh;
    if (refresh) localStorage.setItem('naryadai.refresh', refresh);
    else localStorage.removeItem('naryadai.refresh');
  }
}
export function getAccessToken() {
  return accessToken;
}
export function getRefreshToken() {
  return refreshToken;
}
export function isNetworkFailure(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.set('Authorization', `Bearer ${accessToken}`);
  config.headers.set('Accept-Language', localStorage.getItem('naryadai.lang') || 'ru');
  return config;
});

async function doRefresh(): Promise<string | null> {
  if (!refreshToken) return null;
  if (!refreshPromise) {
    const sessionRefresh = refreshToken;
    refreshPromise = (async () => {
      // refresh идёт по активной базе; при сетевой ошибке пробуем запасную
      const bases =
        activeBase === PRIMARY_API_URL && FALLBACK_API_URL
          ? [activeBase, FALLBACK_API_URL]
          : [activeBase];
      for (const base of bases) {
        try {
          const r = await axios.post(
            `${base}/auth/refresh`,
            { refresh_token: sessionRefresh },
            { timeout: 15000 },
          );
          const access = r.data?.access_token ?? r.data?.accessToken ?? null;
          const refresh = r.data?.refresh_token ?? r.data?.refreshToken ?? null;
          if (refreshToken !== sessionRefresh) return null;
          setTokens(access, refresh ?? refreshToken);
          useAuthStore.getState().setAccessToken(access);
          return access;
        } catch (e) {
          if (
            axios.isAxiosError(e) &&
            !e.response &&
            FALLBACK_API_URL &&
            base === PRIMARY_API_URL
          ) {
            setActiveBase(FALLBACK_API_URL); // сеть на :80 молчит — переключаемся на :8080
            continue;
          }
          throw e;
        }
      }
      return null;
    })()
      .catch((error: unknown) => {
        if (refreshToken !== sessionRefresh) return null;
        // Keep the refresh credential during an outage so the cached read-only
        // session can resume once connectivity returns. HTTP rejections still log out.
        if (isNetworkFailure(error)) {
          setTokens(null);
          useAuthStore.getState().setAccessToken(null);
          return null;
        }
        setTokens(null, null);
        useAuthStore.getState().logout();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Lazy import to avoid cycle (auth-store imports api helpers only at runtime).
import { useAuthStore } from '../store/auth-store';

/** Public wrapper for boot-time session restore: refresh → new access token (or null). */
export function refreshSession(): Promise<string | null> {
  return doRefresh();
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    type Retried = AxiosRequestConfig & { _retried?: boolean; _baseSwitched?: boolean };
    const original = err.config as Retried | undefined;
    // Нет ответа от сервера (сеть/timeout/DNS) — один раз пробуем запасную базу :80<->:8080.
    if (
      !err.response &&
      original &&
      !original._baseSwitched &&
      FALLBACK_API_URL &&
      activeBase === PRIMARY_API_URL
    ) {
      original._baseSwitched = true;
      setActiveBase(FALLBACK_API_URL);
      original.baseURL = FALLBACK_API_URL;
      return api.request(original);
    }
    if (err.response?.status === 401 && original && !original._retried && refreshToken) {
      original._retried = true;
      const access = await doRefresh();
      if (access) {
        original.headers = { ...original.headers, Authorization: `Bearer ${access}` };
        return api.request(original);
      }
    }
    return Promise.reject(err);
  },
);

export interface LocalizedApiError {
  code: string;
  message: string;
  translationKey?: string;
  status?: number;
  requestId?: string;
}

export function toLocalizedError(err: unknown): LocalizedApiError {
  if (axios.isAxiosError(err)) {
    const parsed = ApiErrorSchema.safeParse(err.response?.data);
    if (parsed.success) {
      return {
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        translationKey: parsed.data.error.translation_key,
        status: err.response?.status,
        requestId: parsed.data.request_id,
      };
    }
    // FastAPI fallback shape: {"detail": "..."} or {"detail": [{loc, msg}]} (500s, proxies).
    const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail) {
      return {
        code: `http_${err.response?.status ?? 0}`,
        message: detail,
        status: err.response?.status,
      };
    }
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: string };
      if (first?.msg)
        return { code: 'validation_error', message: first.msg, status: err.response?.status };
    }
    if (!err.response)
      return { code: 'network_error', message: i18n.t('error.network'), status: 0 };
    return {
      code: `http_${err.response.status}`,
      message: `${i18n.t('error.http')} ${err.response.status}`,
      status: err.response.status,
    };
  }
  return { code: 'unknown', message: i18n.t('error.unknown') };
}

/** Mutating requests MUST carry an Idempotency-Key. Caller reuses the same key on retry. */
export function idempotencyHeaders(key?: string): Record<string, string> {
  return { 'Idempotency-Key': key ?? newUUID() };
}

/** UUID без требования SecureContext: в http-WebView crypto.randomUUID недоступен. */
export function newUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* insecure WebView context — fallback ниже */
  }
  // Fallback для http-WebView без SecureContext: уникальности достаточно для ретраев.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
