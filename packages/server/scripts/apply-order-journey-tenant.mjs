#!/usr/bin/env node
/**
 * Apply order_journey tenant_id migration when full `npm run migrate` is blocked
 * by historical check-order conflicts. Idempotent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationName = '1970000000000_order_journey_tenant_id';
const migrationFile = path.join(__dirname, '..', 'migrations', `${migrationName}.js`);
const databaseUrl =
  process.env.DATABASE_URL || 'postgres://m1_user:m1_password@localhost:5432/m1_db';

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const existing = await client.query('SELECT name FROM pgmigrations WHERE name = $1', [
    migrationName,
  ]);
  if (existing.rowCount > 0) {
    console.log(`[ok] ${migrationName} already recorded in pgmigrations`);
  } else {
    const mod = await import(pathToFileURL(migrationFile).href);
    // node-pg-migrate MigrationBuilder shim — only sql() is used by this migration
    const statements = [];
    const pgm = {
      sql: (q) => {
        statements.push(typeof q === 'string' ? q : String(q));
      },
    };
    await mod.up(pgm);
    await client.query('BEGIN');
    for (const sql of statements) {
      await client.query(sql);
    }
    await client.query(
      'INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())',
      [migrationName],
    );
    await client.query('COMMIT');
    console.log(`[ok] Applied ${migrationName}`);
  }

  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'planning' AND table_name = 'order_journey'
    ORDER BY ordinal_position
  `);
  console.log('[schema] planning.order_journey columns:');
  for (const row of cols.rows) {
    console.log(`  - ${row.column_name} ${row.data_type} null=${row.is_nullable}`);
  }

  const idx = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'planning' AND tablename = 'order_journey'
  `);
  console.log('[indexes]');
  for (const row of idx.rows) {
    console.log(`  - ${row.indexname}: ${row.indexdef}`);
  }

  // Ensure m1_app password matches local deploy/.env default for smoke
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm1_app') THEN
        ALTER ROLE m1_app WITH PASSWORD 'm1_app_password' LOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
  `);
  const roles = await client.query(`
    SELECT rolname, rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('m1_app', 'm1_user')
    ORDER BY rolname
  `);
  console.log('[roles]', roles.rows);
} catch (err) {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* ignore */
  }
  console.error('[fail]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
