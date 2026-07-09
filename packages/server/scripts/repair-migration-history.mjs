/**
 * Repair pgmigrations when schema exists but history is missing or out of order.
 *
 * Common cause: ensure-crew-table inserted 1911000000000_machine_crew_roster
 * without earlier migrations, breaking `npm run migrate`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

function listMigrationNames() {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace(/\.js$/, ''))
    .sort();
}

const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
await client.connect();

try {
  const schemaCheck = await client.query(`
    SELECT
      to_regclass('master.machine') AS machine,
      to_regclass('txn.crm6_order') AS crm_order
  `);
  const hasSchema = schemaCheck.rows[0]?.machine && schemaCheck.rows[0]?.crm_order;
  if (!hasSchema) {
    console.error('Core tables missing — run `npm run migrate` on a fresh database instead of repair.');
    process.exitCode = 1;
    process.exit();
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS pgmigrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      run_on TIMESTAMP NOT NULL
    )
  `);

  const existing = await client.query('SELECT name FROM pgmigrations ORDER BY name ASC');
  const existingNames = new Set(existing.rows.map((r) => r.name));
  const allNames = listMigrationNames();

  // Remove orphan future-only records (e.g. crew migration stamped without baseline).
  const orphans = [...existingNames].filter((name) => {
    const firstMissing = allNames.find((m) => !existingNames.has(m));
    return firstMissing && name > firstMissing;
  });

  if (orphans.length > 0) {
    await client.query('DELETE FROM pgmigrations WHERE name = ANY($1::text[])', [orphans]);
    console.log('Removed orphan migration records:', orphans.join(', '));
    orphans.forEach((name) => existingNames.delete(name));
  }

  const toInsert = allNames.filter((name) => !existingNames.has(name));
  if (toInsert.length === 0) {
    console.log('Migration history already complete (%d migrations).', allNames.length);
  } else {
    const baseTime = Date.now();
    for (let i = 0; i < toInsert.length; i++) {
      const runOn = new Date(baseTime + i);
      await client.query('INSERT INTO pgmigrations (name, run_on) VALUES ($1, $2)', [toInsert[i], runOn]);
    }
    console.log('Stamped %d migrations (%d → %d total).', toInsert.length, existingNames.size, allNames.length);
  }

  // Ensure crew table exists even if we only stamped history.
  await client.query(`
    CREATE TABLE IF NOT EXISTS master.machine_crew_roster (
      crew_id       BIGSERIAL PRIMARY KEY,
      machine_code  TEXT NOT NULL REFERENCES master.machine(machine_code) ON DELETE CASCADE,
      member_name   TEXT NOT NULL,
      role_label    TEXT NOT NULL,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ix_machine_crew_roster_machine
      ON master.machine_crew_roster (machine_code)
      WHERE is_active = TRUE;
  `);
  console.log('Crew roster table verified.');
} catch (e) {
  console.error('Repair failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
