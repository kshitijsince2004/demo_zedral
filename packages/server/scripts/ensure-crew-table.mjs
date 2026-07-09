import pg from 'pg';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
await client.connect();
try {
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
  const r = await client.query("SELECT to_regclass('master.machine_crew_roster') AS tbl");
  console.log('crew table:', r.rows[0]?.tbl ?? 'missing');
  console.log('Note: does not modify pgmigrations — use npm run repair:migrations if migrate fails.');
} catch (e) {
  console.error('error:', e.message);
  process.exitCode = 1;
}
await client.end();
