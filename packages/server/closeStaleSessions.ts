import { db } from './src/db';
import { sql } from 'kysely';

async function main() {
  console.log('Running cleanup query...');
  const res = await sql`
    UPDATE txn.machine_shift_session
       SET status = 'CLOSED', closed_at = now()
     WHERE status = 'ACTIVE'
       AND prod_date < (current_date - INTERVAL '1 day')
  `.execute(db);
  console.log('Cleanup query completed', res);
  process.exit(0);
}

main().catch(console.error);
