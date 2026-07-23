import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Operator/APK build: no vite-plugin-pwa. Capacitor owns the native app shell.
// Loads packages/client/.env.operator when --mode operator (see package.json scripts).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const apiProxyTarget =
    env.VITE_API_URL?.replace(/\/$/, '') ||
    `http://127.0.0.1:${rootEnv.PORT || 3005}`;

  return {
  resolve: {
    alias: {
      '@m1/shared-validation': path.resolve(__dirname, '../shared-validation/src/index.ts'),
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    {
      // Operator build has no vite-plugin-pwa; stub avoids crashes if main.tsx is pulled via HMR.
      name: 'operator-pwa-stub',
      resolveId(id) {
        if (id === 'virtual:pwa-register') return id;
      },
      load(id) {
        if (id === 'virtual:pwa-register') {
          return 'export function registerSW() { return () => {}; }';
        }
      },
    },
    {
      // Dev server defaults to index.html (desk app + PWA); operator uses operator.html.
      name: 'operator-dev-entry',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const [pathname, search = ''] = (req.url ?? '').split('?');
          if (pathname === '/' || pathname === '/index.html') {
            req.url = `/operator.html${search ? `?${search}` : ''}`;
          }
          next();
        });
      },
    },
    {
      name: 'operator-capacitor-index',
      closeBundle() {
        const outDir = path.resolve(__dirname, 'dist-operator');
        const operatorHtml = path.join(outDir, 'operator.html');
        const indexHtml = path.join(outDir, 'index.html');
        if (fs.existsSync(operatorHtml)) {
          fs.copyFileSync(operatorHtml, indexHtml);
        }
      },
    },
  ],
  define: {
    __OPERATOR_BUILD__: 'true',
  },
  optimizeDeps: {
    entries: ['operator.html'],
  },
  build: {
    outDir: 'dist-operator',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'operator.html'),
    },
  },
  server: {
    port: 3001,
    open: '/operator.html',
    watch: {
      ignored: ['**/dist-operator/**', '**/android/**'],
    },
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
};
});
