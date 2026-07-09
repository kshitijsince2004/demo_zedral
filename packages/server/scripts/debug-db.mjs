import pg from 'pg';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const url = resolveDatabaseUrl();
console.log('Connecting to:', url.replace(/:[^:@]+@/, ':***@'));

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const tables = [
    'master.shift',
    'master.process',
    'master.customer',
    'master.grade',
    'master.surface_finish',
    'master.defect_code',
    'master.stoppage_code',
    'master.operator',
    'master.furnace',
    'master.rp_oil_grade',
    'security.role',
    'security.app_user',
    'security.user_role',
    'txn.shift_override_audit',
    'txn.shift_event_audit',
    'txn.machine_shift_session'
  ];

  for (const t of tables) {
    try {
      const res = await client.query(`SELECT COUNT(*) as count FROM ${t}`);
      console.log(`Table ${t}: ${res.rows[0].count} rows`);
      if (res.rows[0].count > 0 && t === 'master.shift') {
        const rows = await client.query(`SELECT * FROM ${t}`);
        console.log('Shifts:', rows.rows);
      }
    } catch (err) {
      console.error(`Error querying ${t}:`, err.message);
    }
  }

  await client.end();
}

main().catch(console.error);
