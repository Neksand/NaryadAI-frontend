// Детект запуска внутри Tauri (десктоп / Android WebView).
// В APK history-навигация BrowserRouter ломается на кастомном протоколе
// (рестарт -> несуществующий путь -> пустой экран), поэтому там нужен HashRouter.
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (w.__TAURI__ || w.__TAURI_INTERNALS__ || w.__TAURI_METADATA__) return true;
  const ua = navigator.userAgent || '';
  if (/Tauri/i.test(ua)) return true;
  // Tauri Android грузится с tauri.localhost / asset.localhost / custom scheme
  const proto = window.location.protocol || '';
  if (proto.startsWith('tauri') || proto.startsWith('asset') || proto === 'app:') return true;
  const host = window.location.hostname || '';
  if (host.includes('tauri.localhost') || host.includes('asset.localhost')) return true;
  try {
    if (localStorage.getItem('naryadai.tauri') === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}
