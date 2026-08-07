#!/usr/bin/env node
/**
 * Sync m1_app (or DB_APP_USER) password after migrate.
 * Migration 1797 creates the role with a fixed password; deploy secrets may differ.
 */
import pg from 'pg';

const user = process.env.DB_APP_USER || 'm1_app';
const password = process.env.DB_APP_PASSWORD;
const connectionString = process.env.DATABASE_URL;

if (!password || !connectionString) {
  console.error('[sync-app-role] DB_APP_PASSWORD and DATABASE_URL (migrate) required');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  const { rows } = await client.query(
    `SELECT format('ALTER ROLE %I WITH PASSWORD %L', $1::text, $2::text) AS ddl`,
    [user, password],
  );
  await client.query(rows[0].ddl);
  console.log(`[sync-app-role] Password synced for role ${user}`);
} catch (err) {
  console.error('[sync-app-role]', err.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
