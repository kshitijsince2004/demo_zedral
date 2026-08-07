#!/usr/bin/env node
/**
 * Prefer MIGRATE_DATABASE_URL (bootstrap/superuser) over DATABASE_URL (app RLS role).
 */
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  DATABASE_URL: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL,
};

if (!env.DATABASE_URL) {
  console.error('MIGRATE_DATABASE_URL or DATABASE_URL is required for migrate');
  process.exit(1);
}

const direction = process.argv[2] === 'down' ? 'down' : 'up';

function run(args) {
  const result = spawnSync('npx', ['node-pg-migrate', ...args], {
    stdio: 'inherit',
    env,
    shell: true,
  });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

if (direction === 'down') {
  run(['--migrations-dir', 'migrations/modules/m1', '--migrations-table', 'pgmigrations_m1', 'down']);
  run(['--migrations-dir', 'migrations', 'down']);
} else {
  run(['--migrations-dir', 'migrations', 'up']);
  run(['--migrations-dir', 'migrations/modules/m1', '--migrations-table', 'pgmigrations_m1', 'up']);
}
