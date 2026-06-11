import { mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
import { defineConfig } from 'vitest/config';

export default mergeConfig(
  viteConfig,
  defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
  }),
);
