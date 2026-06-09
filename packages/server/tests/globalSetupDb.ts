import { Pool } from 'pg';

function resolveConnectionString(): string {
  return (
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    `postgres://${process.env.DB_USER || 'm1_user'}:${process.env.DB_PASSWORD || 'm1_password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'm1_db'}`
  );
}

export default async function globalSetup() {
  const pool = new Pool({ connectionString: resolveConnectionString() });

  try {
    await pool.query('SELECT 1');
    process.env.VITEST_DB_AVAILABLE = '1';
  } catch {
    process.env.VITEST_DB_AVAILABLE = '0';
    console.warn('[vitest] PostgreSQL is not reachable — integration tests will be skipped.');
  } finally {
    await pool.end();
  }
}
