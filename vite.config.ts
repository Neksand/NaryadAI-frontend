import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
  ],
  server: {
    port: 5173,
    proxy: {
      // Optional local dev proxy to avoid CORS when backend runs on :8080.
      // Prefer VITE_API_URL=http://localhost:8080/api/v1 directly (backend CORS already allows :5173).
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
