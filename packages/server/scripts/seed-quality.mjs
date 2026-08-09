#!/usr/bin/env node
/**
 * Seed QUALITY staff account for the Quality Spec dashboard.
 * Usage: npm run seed:quality  (from packages/server)
 */
import { seedPilotUsers } from './seed-pilot-users.mjs';
import { resolveOwnerDatabaseUrl } from './lib/database-url.mjs';

const PRIMARY_URL = resolveOwnerDatabaseUrl();

async function main() {
  console.log('=== Zedral Quality Seed ===\n');
  console.log(`Database: ${PRIMARY_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  const { staffPassword, users, userIds } = await seedPilotUsers(PRIMARY_URL);
  const quality = users.find((u) => u.username === 'quality');
  if (!quality || !userIds.quality) {
    throw new Error('Quality user was not created — ensure migrations (role QUALITY / role_id 6) ran');
  }

  console.log('\n=== Quality seed complete ===');
  console.log('Login (Staff email mode):');
  console.log(`  Email     quality@zedral.local`);
  console.log(`  Password  ${staffPassword}`);
  console.log('  Lands on  /quality/specs');
  console.log('\nOr Admin staff login also has Quality access:');
  console.log(`  Email     admin@zedral.local`);
  console.log(`  Password  ${staffPassword}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
