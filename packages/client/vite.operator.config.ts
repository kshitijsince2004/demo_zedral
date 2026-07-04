import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Operator/APK build: no vite-plugin-pwa. Capacitor owns the native app shell.
export default defineConfig({
  resolve: {
    alias: {
      '@m1/shared-validation': path.resolve(__dirname, '../shared-validation/src/index.ts'),
    },
  },
  plugins: [
    tailwindcss(),
    react(),
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
  build: {
    outDir: 'dist-operator',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'operator.html'),
    },
  },
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
