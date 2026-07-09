import pg from 'pg';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
await client.connect();
try {
  const tables = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name = 'pgmigrations'
  `);
  console.log('pgmigrations tables:', tables.rows);

  for (const row of tables.rows) {
    const fq = `${row.table_schema}.${row.table_name}`;
    const count = await client.query(`SELECT COUNT(*)::int AS n FROM ${fq}`);
    const names = await client.query(`SELECT id, name, run_on FROM ${fq} ORDER BY run_on ASC`);
    console.log(`\n${fq}: ${count.rows[0].n} rows`);
    console.log(names.rows);
  }

  const crew = await client.query("SELECT to_regclass('master.machine_crew_roster') AS tbl");
  console.log('\nmachine_crew_roster:', crew.rows[0]?.tbl);
} finally {
  await client.end();
}
