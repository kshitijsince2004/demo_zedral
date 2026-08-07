#!/usr/bin/env node
/**
 * Apply PERF-F2 shift_log composite index when full `npm run migrate` is blocked.
 * Idempotent.
 *
 * Usage: node --env-file=../../.env scripts/apply-shift-log-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationName = '1971000000000_shift_log_prod_date_process_index';
const migrationFile = path.join(__dirname, '..', 'migrations', `${migrationName}.js`);
const databaseUrl =
  process.env.DATABASE_URL || 'postgres://m1_user:m1_password@localhost:5432/m1_db';

if (!fs.existsSync(migrationFile)) {
  console.error(`[FAIL] missing ${migrationFile}`);
  process.exit(1);
}

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
    await client.query('INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())', [
      migrationName,
    ]);
    await client.query('COMMIT');
    console.log(`[ok] Applied ${migrationName}`);
  }

  const idx = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'txn'
      AND tablename = 'shift_log'
      AND indexname = 'ix_shiftlog_date_process_shift'
  `);
  if (idx.rowCount === 0) {
    console.error('[FAIL] index ix_shiftlog_date_process_shift not found');
    process.exitCode = 1;
  } else {
    console.log(`[ok] ${idx.rows[0].indexname}: ${idx.rows[0].indexdef}`);
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('[FAIL]', err);
  process.exitCode = 1;
} finally {
  await client.end();
}
