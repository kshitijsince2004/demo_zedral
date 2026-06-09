import { spawnSync } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;

function connectionString() {
  return (
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || 'm1_user'}:${process.env.DB_PASSWORD || 'm1_password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'm1_db'}`
  );
}

async function isDatabaseReachable() {
  const pool = new Pool({ connectionString: connectionString() });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

const reachable = await isDatabaseReachable();
if (!reachable) {
  console.log('Skipping server integration tests — PostgreSQL is not available.');
  process.exit(0);
}

const result = spawnSync('npx', ['vitest', 'run', '-c', 'vitest.integration.config.ts'], {
  stdio: 'inherit',
  env: { ...process.env, VITEST_DB_AVAILABLE: '1' },
  shell: true,
});

process.exit(result.status ?? 1);
