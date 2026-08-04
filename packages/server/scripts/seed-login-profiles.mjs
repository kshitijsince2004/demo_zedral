#!/usr/bin/env node
/**
 * Production login seed — users (badge/PIN/roles) + machine master registry.
 * Does NOT load demo coils, PPC batches, or shift logs.
 *
 * Usage:
 *   npm run seed:profiles
 *   SEED_PIN=5678 npm run seed:profiles
 *
 * On EC2 VM:
 *   docker compose -f deploy/docker-compose.prod.yml exec backend npm run seed:profiles
 */
import { seedPilotUsers } from './seed-pilot-users.mjs';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const PRIMARY_URL = resolveDatabaseUrl();

async function main() {
  console.log('=== Zedral Login Profiles + Machines Seed ===\n');
  console.log(`Database: ${PRIMARY_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  const { pin, staffPassword, users } = await seedPilotUsers(PRIMARY_URL);

  console.log('\n=== Seed complete ===');
  console.log(`Operator PIN: ${pin}${process.env.SEED_PIN ? '' : ' (set SEED_PIN to override — rotate after first login)'}`);
  console.log(`Staff password: ${staffPassword}${process.env.SEED_STAFF_PASSWORD ? '' : ' (set SEED_STAFF_PASSWORD to override)'}`);
  console.log('\nLogin profiles:');
  for (const u of users) {
    const machines = u.machines?.length ? u.machines.join(', ') : '(all — via role)';
    if (u.staff) {
      console.log(`  ${`${u.username}@zedral.local`.padEnd(28)}  ${u.full_name.padEnd(18)} role_id=${u.role_id}  machines: ${machines}`);
    } else {
      console.log(`  Badge ${u.emp_code.padEnd(22)}  ${u.full_name.padEnd(18)} role_id=${u.role_id}  machines: ${machines}`);
    }
  }
  console.log('\nStaff (email tab):');
  console.log(`  admin@zedral.local / ${staffPassword} → Admin`);
  console.log(`  machinehead@zedral.local / ${staffPassword} → Machine Head (6HI/4HI/2HI/ANN — switch Line to ANN)`);
  console.log(`  machinehead.ann@zedral.local / ${staffPassword} → ANN Machine Head (ANN desk only)`);
  console.log(`  supervisor@zedral.local / ${staffPassword} → Supervisor`);
  console.log(`  planthead@zedral.local / ${staffPassword} → Plant Head`);
  console.log('\nOperator (badge tab):');
  console.log(`  Badge 3000 / PIN ${pin} → Operator (/operator.operator → 6HI)`);
  console.log(`  Badge 3010 / PIN ${pin} → ANN Operator`);
  console.log('\nFor demo coils + ANN board/batching: npm run seed:process-queues');
  console.log('For ANN only (uses imported PPC queue): npm run seed:ann');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
