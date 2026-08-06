#!/usr/bin/env node
/**
 * Clears operational/demo data while preserving login accounts (security.app_user
 * and related role/access rows). Then safe to run seed:pilot or seed:data.
 *
 * Usage: npm run clear:data -w @m1/server
 */
import pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';

/** Tables kept intact — user logins and auth reference data. */
const PRESERVE_TABLES = new Set([
  'security.app_user',
  'security.user_role',
  'security.line_access',
  'security.machine_access',
  'security.role',
  'security.tenant',
  'security.tenant_config',
  'security.permission',
  // Migration-seeded reference masters (not demo data)
  'master.process',
  'master.machine',
  'master.crm_sub_process',
  'master.stoppage_category',
  'master.line_area',
  'master.route_code',
  'master.furnace',
  'master.grade_spec',
  'master.rp_oil_grade',
]);

/** Whole schemas skipped — SuperTokens credentials + migration history. */
const PRESERVE_SCHEMAS = new Set(['public', 'pg_catalog', 'information_schema']);

export async function clearPilotData(databaseUrl = DATABASE_URL) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows } = await client.query(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename
    `);

    const toClear = rows
      .map((r) => `${r.schemaname}.${r.tablename}`)
      .filter((fqn) => {
        const schema = fqn.split('.')[0];
        return !PRESERVE_SCHEMAS.has(schema) && !PRESERVE_TABLES.has(fqn);
      });

    if (toClear.length === 0) {
      console.log('No tables to clear.');
      return { cleared: 0, preserved: [...PRESERVE_TABLES] };
    }

    const usersBefore = await client.query(
      `SELECT emp_code, username, user_id FROM security.app_user ORDER BY emp_code`,
    );

    await client.query('BEGIN');
    const quoted = toClear.map((t) => `"${t.replace('.', '"."')}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    await client.query('COMMIT');

    const usersAfter = await client.query(
      `SELECT COUNT(*)::int AS n FROM security.app_user`,
    );

    console.log(`Cleared ${toClear.length} tables (login accounts preserved: ${usersAfter.rows[0].n})`);
    for (const u of usersBefore.rows) {
      console.log(`  kept user ${u.emp_code} (${u.username}) id=${u.user_id}`);
    }

    return { cleared: toClear.length, users: usersBefore.rows };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1]?.includes('clear-pilot-data');
if (isMain) {
  console.log('=== Clear pilot data (preserve logins) ===\n');
  clearPilotData()
    .then(() => console.log('\nClear complete. Run: npm run seed:data'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
