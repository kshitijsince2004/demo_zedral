#!/usr/bin/env node
/**
 * Ensure platform-native optional packages exist after npm ci.
 *
 * Windows-generated lockfiles often omit Linux optional natives (npm/cli#4828).
 * Vite 8 (rolldown), vite-plugin-pwa/workbox (rollup), Tailwind (lightningcss/oxide)
 * all need the host OS binding or the client build dies mid-pipeline.
 *
 * Usage: node scripts/ensure-native-bindings.mjs
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

function isMusl() {
  if (process.platform !== 'linux') return false;
  if (existsSync('/etc/alpine-release')) return true;
  try {
    const { familySync } = require('detect-libc');
    return familySync() === 'musl';
  } catch {
    try {
      return readFileSync('/usr/bin/ldd', 'utf8').includes('musl');
    } catch {
      return false;
    }
  }
}

/** @type {Record<string, string[]>} package@version pins matching package.json optionalDependencies */
const BY_PLATFORM = {
  'win32': [
    '@rolldown/binding-win32-x64-msvc@1.0.2',
    '@rollup/rollup-win32-x64-msvc@4.60.4',
    '@esbuild/win32-x64@0.21.5',
    'lightningcss-win32-x64-msvc@1.32.0',
    '@tailwindcss/oxide-win32-x64-msvc@4.3.0',
  ],
  'linux-gnu': [
    '@rolldown/binding-linux-x64-gnu@1.0.2',
    '@rollup/rollup-linux-x64-gnu@4.60.4',
    '@esbuild/linux-x64@0.21.5',
    'lightningcss-linux-x64-gnu@1.32.0',
    '@tailwindcss/oxide-linux-x64-gnu@4.3.0',
  ],
  'linux-musl': [
    '@rolldown/binding-linux-x64-musl@1.0.2',
    '@rollup/rollup-linux-x64-musl@4.60.4',
    '@esbuild/linux-x64@0.21.5',
    'lightningcss-linux-x64-musl@1.32.0',
    '@tailwindcss/oxide-linux-x64-musl@4.3.0',
  ],
};

function platformKey() {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'linux') return isMusl() ? 'linux-musl' : 'linux-gnu';
  return null;
}

function packageName(spec) {
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

function present(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

const key = platformKey();
if (!key) {
  console.log(`[ensure-native-bindings] skip unsupported platform ${process.platform}`);
  process.exit(0);
}

const missing = BY_PLATFORM[key].filter((spec) => !present(packageName(spec)));
if (missing.length === 0) {
  console.log(`[ensure-native-bindings] OK (${key})`);
  process.exit(0);
}

console.log(`[ensure-native-bindings] installing for ${key}: ${missing.join(', ')}`);
const result = spawnSync(
  'npm',
  ['install', '--no-save', '--no-package-lock', ...missing],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
