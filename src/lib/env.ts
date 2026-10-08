// Environment-only configuration. Never hardcode backend URLs in components.
export const API_URL = import.meta.env.VITE_API_URL as string;
export const WS_URL = import.meta.env.VITE_WS_URL as string;

if (!API_URL) console.error('[config] VITE_API_URL is not set');
if (!WS_URL) console.error('[config] VITE_WS_URL is not set');

export function wsUrlWithToken(token: string): string {
  const sep = WS_URL.includes('?') ? '&' : '?';
  return `${WS_URL}${sep}token=${encodeURIComponent(token)}`;
}
