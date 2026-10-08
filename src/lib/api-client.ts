import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { API_URL } from './env';
import { ApiErrorSchema } from '../types/domain';

// Single axios instance for the whole app. Auth header + refresh + idempotency live here.
export const api = axios.create({ baseURL: API_URL, timeout: 20000 });

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
export function getAccessToken() { return accessToken; }
export function getRefreshToken() { return refreshToken; }

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.set('Authorization', `Bearer ${accessToken}`);
  config.headers.set('Accept-Language', localStorage.getItem('naryadai.lang') || 'ru');
  return config;
});

async function doRefresh(): Promise<string | null> {
  if (!refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken }, { timeout: 15000 })
      .then((r) => {
        const access = r.data?.access_token ?? r.data?.accessToken ?? null;
        const refresh = r.data?.refresh_token ?? r.data?.refreshToken ?? null;
        setTokens(access, refresh ?? refreshToken);
        useAuthStore.getState().setAccessToken(access);
        return access;
      })
      .catch(() => {
        setTokens(null, null);
        useAuthStore.getState().logout();
        return null;
      })
      .finally(() => { refreshPromise = null; });
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
    const original = err.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
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
      return { code: `http_${err.response?.status ?? 0}`, message: detail, status: err.response?.status };
    }
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return { code: 'validation_error', message: first.msg, status: err.response?.status };
    }
    if (!err.response) return { code: 'network_error', message: 'Нет связи с сервером', status: 0 };
    return { code: `http_${err.response.status}`, message: `Ошибка ${err.response.status}`, status: err.response.status };
  }
  return { code: 'unknown', message: 'Неизвестная ошибка' };
}

/** Mutating requests MUST carry an Idempotency-Key. Caller reuses the same key on retry. */
export function idempotencyHeaders(key?: string): Record<string, string> {
  return { 'Idempotency-Key': key ?? crypto.randomUUID() };
}
