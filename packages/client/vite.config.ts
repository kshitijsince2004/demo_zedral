import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const apiProxyTarget =
    (env.VITE_API_URL ?? '').replace(/\/$/, '') ||
    `http://127.0.0.1:${rootEnv.PORT || 3005}`;
  const swApiReadCache = env.VITE_SW_API_READ_CACHE !== 'false';

  const runtimeCaching = swApiReadCache
    ? [
        {
          urlPattern: /\/api\/(live|reports|traceability|machines|shifts|6hi)\/.*/i,
          method: 'GET' as const,
          handler: 'NetworkFirst' as const,
          options: {
            cacheName: 'api-reads',
            networkTimeoutSeconds: 3,
            expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          urlPattern: /\/api\/.*/i,
          method: 'POST' as const,
          handler: 'NetworkOnly' as const,
        },
        {
          urlPattern: /\/api\/.*/i,
          method: 'PUT' as const,
          handler: 'NetworkOnly' as const,
        },
        {
          urlPattern: /\/api\/.*/i,
          method: 'PATCH' as const,
          handler: 'NetworkOnly' as const,
        },
        {
          urlPattern: /\/api\/.*/i,
          method: 'DELETE' as const,
          handler: 'NetworkOnly' as const,
        },
        {
          urlPattern: /\/api\/.*/i,
          handler: 'NetworkOnly' as const,
        },
        {
          urlPattern: /\/pwa-.*\.png$/i,
          handler: 'NetworkFirst' as const,
          options: {
            cacheName: 'pwa-icons',
            expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 7 },
            cacheableResponse: { statuses: [200] },
          },
        },
        {
          urlPattern: /\/api\/master-data\/.*/i,
          handler: 'NetworkFirst' as const,
          options: {
            cacheName: 'master-data-cache',
            expiration: {
              maxEntries: 100,
              maxAgeSeconds: 60 * 60 * 24 * 7,
            },
            cacheableResponse: {
              statuses: [0, 200],
            },
          },
        },
        {
          urlPattern: /\/api\/import\/.*/i,
          handler: 'NetworkFirst' as const,
          options: {
            cacheName: 'planning-data-cache',
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 60 * 60 * 24,
            },
            cacheableResponse: {
              statuses: [0, 200],
            },
          },
        },
      ]
    : [
        {
          urlPattern: /\/api\/.*/i,
          handler: 'NetworkOnly' as const,
        },
        {
          urlPattern: /\/pwa-.*\.png$/i,
          handler: 'NetworkFirst' as const,
          options: {
            cacheName: 'pwa-icons',
            expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 7 },
            cacheableResponse: { statuses: [200] },
          },
        },
        {
          urlPattern: /\/api\/master-data\/.*/i,
          handler: 'NetworkFirst' as const,
          options: {
            cacheName: 'master-data-cache',
            expiration: {
              maxEntries: 100,
              maxAgeSeconds: 60 * 60 * 24 * 7,
            },
            cacheableResponse: {
              statuses: [0, 200],
            },
          },
        },
        {
          urlPattern: /\/api\/import\/.*/i,
          handler: 'NetworkFirst' as const,
          options: {
            cacheName: 'planning-data-cache',
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 60 * 60 * 24,
            },
            cacheableResponse: {
              statuses: [0, 200],
            },
          },
        },
      ];

  return {
    resolve: {
      alias: {
        '@m1/shared-validation': path.resolve(__dirname, '../shared-validation/src/index.ts'),
      },
    },
    plugins: [
      tailwindcss(),
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'pwa-192x192.png',
          'pwa-512x512.png',
          'src/assets/favicon.ico',
          'apple-touch-icon.png',
          'masked-icon.svg',
        ],
        manifest: {
          name: 'M1 Digital Data Collection',
          short_name: 'M1 Data',
          description: 'Offline-First Digital Data Capture for Hero Steels',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          navigateFallbackDenylist: [/^\/api/],
          runtimeCaching,
        },
      }),
    ],
    server: {
      port: 3000,
      watch: {
        ignored: ['**/dist-operator/**', '**/android/**'],
      },
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/auth': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
