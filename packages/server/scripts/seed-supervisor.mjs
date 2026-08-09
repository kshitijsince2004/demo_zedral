#!/usr/bin/env node
/**
 * Seed supervisor account
 */
import { seedPilotUsers } from './seed-pilot-users.mjs';
import { resolveOwnerDatabaseUrl } from './lib/database-url.mjs';

const PRIMARY_URL = resolveOwnerDatabaseUrl();

async function main() {
  console.log('=== Zedral Supervisor Seed ===\n');
  console.log(`Database: ${PRIMARY_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  const { pin, staffPassword, users } = await seedPilotUsers(PRIMARY_URL);

  console.log('\n=== Supervisor seed complete ===');
  console.log(`Supervisor account created: supervisor@zedral.local / ${staffPassword}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
