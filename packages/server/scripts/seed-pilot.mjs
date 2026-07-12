#!/usr/bin/env node
/**
 * Full pilot seed: users + demo data on primary and replica.
 * Usage: npm run seed:pilot
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedPilotData } from './seed-pilot-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

const PRIMARY_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';
const REPLICA_URL =
  process.env.DATABASE_REPLICA_URL ||
  'postgres://m1_user:m1_password@localhost:5433/m1_db';

function runScript(scriptName, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(__dirname, scriptName)], {
      cwd: serverRoot,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
      shell: true,
    });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${scriptName} exited ${code}`))));
  });
}

async function main() {
  console.log('=== Zedral M1 Pilot Seed ===\n');

  console.log('1/3 Seeding users (primary)...');
  console.log(`    ${PRIMARY_URL.replace(/:[^:@]+@/, ':***@')}`);
  await runScript('seed-pilot-users.mjs', { DATABASE_URL: PRIMARY_URL });

  console.log('\n2/3 Seeding demo data (primary)...');
  console.log(`    ${PRIMARY_URL.replace(/:[^:@]+@/, ':***@')}`);
  await seedPilotData(PRIMARY_URL);

  console.log('\n3/3 Seeding demo data (replica for reporting)...');
  console.log(`    ${REPLICA_URL.replace(/:[^:@]+@/, ':***@')}`);
  try {
    await seedPilotData(REPLICA_URL);
  } catch (err) {
    console.warn('  Replica seed skipped:', err.message);
    console.warn('  (Reporting dashboards need replica data when DB_REPLICA_HOST is set)');
  }

  console.log('\n=== Seed complete ===');
  console.log('Login PIN: 1234');
  console.log('  Badge 1000 — Admin');
  console.log('  Badge 3000 — Operator');
  console.log('  Badge 4000 — Machine Head');
  console.log('  Badge 5000 — Plant Head');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
