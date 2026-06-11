#!/usr/bin/env node
/**
 * Production login seed — users (badge/PIN/roles) + machine master registry.
 * Does NOT load demo coils, PPC batches, or shift logs.
 *
 * Usage:
 *   npm run seed:profiles
 *   SEED_PIN=5678 npm run seed:profiles
 *
 * On GCP VM:
 *   docker compose -f deploy/docker-compose.prod.yml exec backend npm run seed:profiles
 */
import { seedPilotUsers } from './seed-pilot-users.mjs';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const PRIMARY_URL = resolveDatabaseUrl();

async function main() {
  console.log('=== Zedral Login Profiles + Machines Seed ===\n');
  console.log(`Database: ${PRIMARY_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  const { pin, users } = await seedPilotUsers(PRIMARY_URL);

  console.log('\n=== Seed complete ===');
  console.log(`Default PIN: ${pin}${process.env.SEED_PIN ? '' : ' (set SEED_PIN to override — rotate after first login)'}`);
  console.log('\nLogin profiles:');
  for (const u of users) {
    const machines = u.machines?.length ? u.machines.join(', ') : '(all — via role)';
    console.log(`  Badge ${u.emp_code}  ${u.full_name.padEnd(18)} role_id=${u.role_id}  machines: ${machines}`);
  }
  console.log('\nExamples:');
  console.log(`  Badge 1000 / PIN ${pin} → Admin (/admin/master-data)`);
  console.log(`  Badge 2000 / PIN ${pin} → Supervisor`);
  console.log(`  Badge 3000 / PIN ${pin} → Operator (/operator.operator → 6HI)`);
  console.log(`  Badge 4000 / PIN ${pin} → Machine Head (/machine-head-dashboard)`);
  console.log(`  Badge 5000 / PIN ${pin} → Plant Head (/plant)`);
  console.log('\nFor demo coils + PPC queue, run: npm run seed:admin');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
