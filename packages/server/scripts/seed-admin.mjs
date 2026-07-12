#!/usr/bin/env node
/**
 * Full admin environment seed — not bare PPC rows.
 *
 * Sets up:
 *   - Admin user (badge 1000) + machine head + operator (PIN 1234)
 *   - Master data, coils, shift logs, production, stoppages, defects
 *   - 6HI queue via planning.import_batch (as if admin uploaded PPC)
 *   - SAP plan import batch attributed to admin
 *
 * Usage: npm run seed:admin
 */
import { seedPilotUsers } from './seed-pilot-users.mjs';
import { seedPilotData } from './seed-pilot-data.mjs';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const PRIMARY_URL = resolveDatabaseUrl();

async function main() {
  console.log('=== Zedral Admin Seed ===\n');
  console.log(`Database: ${PRIMARY_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  console.log('1/2 Creating users…');
  const { pin, userIds } = await seedPilotUsers(PRIMARY_URL);
  const adminUserId = userIds.admin;
  if (!adminUserId) {
    throw new Error('Admin user was not created — check migrations and security.tenant_config');
  }
  console.log(`  Admin user_id=${adminUserId} (badge 1000, PIN ${pin})`);

  console.log('\n2/2 Loading plant demo data + admin-attributed imports…');
  await seedPilotData(PRIMARY_URL, { adminUserId });

  console.log('\n=== Admin seed complete ===');
  console.log('Login as admin:');
  console.log(`  Badge  1000  PIN  ${pin}  →  /admin/planning, /admin/users, reports`);
  console.log(`  Badge  2000  PIN  ${pin}  →  machine head review queue`);
  console.log(`  Badge  3000  PIN  ${pin}  →  /6hi operator queue`);
  console.log('\n6HI operator queue: http://localhost:3000/6hi');
  console.log('Admin planning:       http://localhost:3000/admin/planning');
  console.log('Export reports:       http://localhost:3000/reports');
  console.log('\nExport test month: current month (June 2026 demo window Jun 1–7)');
  console.log('  DPR → Reports → DPR export (month picker)');
  console.log('  LINE_LOG / COIL_TRACE / RAW → Reports → Export data');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
