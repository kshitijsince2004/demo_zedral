#!/usr/bin/env node
/**
 * Prefer MIGRATE_DATABASE_URL (bootstrap/superuser) over DATABASE_URL (app RLS role).
 *
 * Default: --no-check-order (QA/Factory DBs that applied later timestamps before
 * mid-timeline files existed). Set MIGRATE_STRICT_ORDER=1 on empty/CI DBs to
 * re-enable ordering checks. See doc/MIGRATION_RUNBOOK.md.
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

const direction = process.argv[2] === 'down' || process.argv[2] === 'down-all' ? 'down' : 'up';
const downAll = process.argv[2] === 'down-all';
const orderFlags =
  process.env.MIGRATE_STRICT_ORDER === '1' || process.env.MIGRATE_STRICT_ORDER === 'true'
    ? []
    : ['--no-check-order'];

function run(args) {
  const result = spawnSync('npx', ['node-pg-migrate', ...args], {
    stdio: 'inherit',
    env,
    shell: true,
  });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

if (direction === 'down') {
  const countFlags = downAll ? ['--count', '10000'] : [];
  run(['--migrations-dir', 'migrations/modules/m1', '--migrations-table', 'pgmigrations_m1', ...orderFlags, ...countFlags, 'down']);
  run(['--migrations-dir', 'migrations', ...orderFlags, ...countFlags, 'down']);
} else {
  run(['--migrations-dir', 'migrations', ...orderFlags, 'up']);
  run(['--migrations-dir', 'migrations/modules/m1', '--migrations-table', 'pgmigrations_m1', ...orderFlags, 'up']);
}
