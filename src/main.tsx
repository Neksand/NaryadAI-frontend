import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import './i18n/config';
import App from './App.tsx';
import { bindAuthQueryCache } from './lib/auth-query-cache';
import { isTauri } from './lib/is-tauri';

// Tauri APK/WebView: только HashRouter (BrowserRouter даёт пустой экран
// на кастомном протоколе после рестарта). Веб/PWA: BrowserRouter.
const Router = isTauri() ? HashRouter : BrowserRouter;

// Глобальный лог ошибок в WebView: иначе белый/чёрный экран без причины.
window.addEventListener('error', (e) => {
  // eslint-disable-next-line no-console
  console.error('[boot-error]', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  // eslint-disable-next-line no-console
  console.error('[boot-rejection]', e.reason);
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15000 },
    mutations: { retry: 0 },
  },
});

bindAuthQueryCache(queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <App />
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
