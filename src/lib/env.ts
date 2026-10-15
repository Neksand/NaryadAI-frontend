// Environment-only configuration. Never hardcode backend URLs in components.
export const API_URL = (import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:8080/api/v1' : '')) as string;
export const WS_URL = (import.meta.env.VITE_WS_URL ||
  (import.meta.env.DEV ? 'ws://127.0.0.1:8080/api/ws' : '')) as string;

if (!API_URL) console.error('[config] VITE_API_URL is not set');
if (!WS_URL) console.error('[config] VITE_WS_URL is not set');

export function isLoopbackApi(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1'
    );
  } catch {
    return false;
  }
}

// Явный флаг для демо-стендов (жюри): VITE_DEMO_LOGIN=true показывает
// панель быстрого входа с синтетическими аккаунтами и на прод-сборке.
// Без флага панель видна только при loopback-API, чтобы не светить демо-PIN.
export const SHOW_DEMO_LOGIN = import.meta.env.VITE_DEMO_LOGIN === 'true' || isLoopbackApi(API_URL);

export function websocketUrlWithToken(
  websocketUrl: string,
  token: string,
  pageHref: string,
): string {
  const url = new URL(websocketUrl, pageHref);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new TypeError(`Unsupported WebSocket protocol: ${url.protocol}`);
  }
  url.searchParams.set('token', token);
  return url.toString();
}

export function wsUrlWithToken(token: string): string {
  const pageHref = typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
  return websocketUrlWithToken(WS_URL, token, pageHref);
}
