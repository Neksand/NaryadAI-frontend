import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Tauri Android/iOS/Desktop: Service Worker и navigateFallback ломают
  // WebView (stale-кэш -> пустой/чёрный экран), поэтому PWA только для веба.
  const isTauri =
    !!process.env.TAURI_ENV_PLATFORM ||
    !!process.env.TAURI_PLATFORM ||
    env.TAURI_ENV_PLATFORM ||
    env.VITE_TAURI === '1';

  return {
    // Для tauri.localhost абсолютный base '/' корректен, относительный './'
    // ломает lazy-чанки. Оставляем '/' для обеих платформ.
    base: '/',
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 1200,
    },
    // Vitest uses esbuild for TSX transforms; Vite 8 production builds use Oxc.
    ...(mode === 'test' ? { esbuild: { jsx: 'automatic' } } : {}),
    plugins: [
      react({ jsxRuntime: 'automatic' }),
      tailwindcss(),
      ...(isTauri
        ? []
        : [
            VitePWA({
              registerType: 'autoUpdate',
              // Манифест — единый статичный public/manifest.webmanifest (дубль от плагина отключён).
              manifest: false,
              includeAssets: ['icon.svg', 'favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512.png', 'apple-touch-icon.png'],
              workbox: {
                navigateFallback: '/index.html',
                runtimeCaching: [
                  {
                    urlPattern: /^https?:\/\/.*\/api\/v1\/(sites|teams|equipment|materials|fault-codes)/,
                    handler: 'StaleWhileRevalidate',
                    options: { cacheName: 'naryadai-catalog', expiration: { maxEntries: 100, maxAgeSeconds: 3600 } },
                  },
                ],
              },
            }),
          ]),
    ],
    server: {
      port: 5173,
      proxy: {
        // Optional local dev proxy to avoid CORS when backend runs on :8080.
        // Prefer VITE_API_URL=http://localhost:8080/api/v1 directly (backend CORS already allows :5173).
        // ws:true — иначе живой WS не проходит через dev-сервер и realtime-E2E скипаются.
        '/api': { target: 'http://localhost:8080', changeOrigin: true, ws: true },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      setupFiles: ['./vitest.setup.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['**/*.test.*', 'src/test-utils.tsx', 'src/main.tsx'],
        reportsDirectory: 'coverage',
        reporter: ['text', 'json-summary', 'lcov'],
        thresholds: { statements: 86, branches: 79, functions: 80, lines: 86 },
      },
    },
  };
})
