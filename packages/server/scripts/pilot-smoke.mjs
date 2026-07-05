#!/usr/bin/env node
/**
 * Pilot smoke test runner — verifies batch 1–12 deliverables.
 * Usage: node scripts/pilot-smoke.mjs [--skip-tests] [--migrate]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '../..');

const args = process.argv.slice(2);
const skipTests = args.includes('--skip-tests');
const runMigrate = args.includes('--migrate');

const BATCH_TESTS = [
  'tests/shiftLogValidation.test.ts',
  'tests/handover.test.ts',
  'tests/userRoutes.test.ts',
  'tests/userService.test.ts',
  'tests/exportRoutes.test.ts',
  'tests/csvWriter.test.ts',
  'tests/kpiCalculator.test.ts',
  'tests/reportRoutes.test.ts',
  'tests/rbac.test.ts',
  'tests/auth.test.ts',
  'tests/csvParser.test.ts',
];

const results = [];

function log(section, status, detail = '') {
  const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '!' : '✗';
  results.push({ section, status, detail });
  console.log(`${icon} [${status}] ${section}${detail ? ` — ${detail}` : ''}`);
}

function run(cmd, cmdArgs, cwd) {
  const proc = spawnSync(cmd, cmdArgs, {
    cwd,
    shell: true,
    encoding: 'utf8',
    env: process.env,
  });
  return proc;
}

async function checkDatabase() {
  const url =
    process.env.DATABASE_URL ||
    'postgres://m1_user:m1_password@localhost:5432/m1_db';

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const applied = await client.query(
      'SELECT name FROM pgmigrations ORDER BY run_on DESC LIMIT 15',
    );
    const pending = [
      '1781000000001_user_pin_hash',
      '1781000000002_import_batch_errors',
      '1781000000003_audit_baseline_triggers',
      '1781000000004_handover_attestation',
      '1781000000005_change_request_rejection_note',
    ];
    const appliedNames = new Set(applied.rows.map((r) => r.name));
    const notApplied = pending.filter((m) => !appliedNames.has(m));

    log('Database connectivity', 'PASS', url.replace(/:[^:@]+@/, ':***@'));
    if (notApplied.length > 0) {
      log(
        'Pending migrations',
        'WARN',
        `${notApplied.length} batch migrations not applied: ${notApplied.join(', ')}`,
      );
    } else {
      log('Batch migrations (1781*)', 'PASS', 'all 5 applied');
    }
    return true;
  } catch (err) {
    log(
      'Database connectivity',
      'FAIL',
      err.code === 'ECONNREFUSED'
        ? 'PostgreSQL not reachable — start Docker: docker compose up -d db-primary'
        : err.message,
    );
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

function checkEnvFiles() {
  const envPath = path.join(serverRoot, '.env');
  if (existsSync(envPath)) {
    log('Server .env', 'PASS', envPath);
  } else {
    log('Server .env', 'WARN', 'missing — copy from .env.example');
  }
}

function checkCriticalFiles() {
  const files = [
    'src/services/ExportService.ts',
    'src/services/ReportingService.ts',
    'src/services/UserService.ts',
    'src/routes/exportRoutes.ts',
    'src/routes/reportRoutes.ts',
    'src/routes/userRoutes.ts',
    'src/utils/kpiCalculator.ts',
    'migrations/1781000000004_handover_attestation.js',
    'migrations/1781000000005_change_request_rejection_note.js',
  ];
  const missing = files.filter((f) => !existsSync(path.join(serverRoot, f)));
  if (missing.length === 0) {
    log('Batch deliverable files', 'PASS', `${files.length} files present`);
  } else {
    log('Batch deliverable files', 'FAIL', `missing: ${missing.join(', ')}`);
  }
}

function runBatchTests() {
  const proc = run('npx', ['vitest', 'run', ...BATCH_TESTS], serverRoot);
  if (proc.status === 0) {
    const match = proc.stdout?.match(/Tests\s+(\d+) passed/);
    log('Batch unit tests (server)', 'PASS', match ? `${match[1]} passed` : '');
  } else {
    log('Batch unit tests (server)', 'FAIL', 'see vitest output above');
    if (proc.stdout) console.log(proc.stdout);
    if (proc.stderr) console.error(proc.stderr);
  }
}

function runClientSmoke() {
  const proc = run(
    'npx',
    ['vitest', 'run', 'tests/dashboard.test.ts', 'tests/machineRouting.test.ts'],
    path.join(repoRoot, 'packages/client'),
  );
  if (proc.status === 0) {
    log('Client smoke tests', 'PASS', 'dashboard + machineRouting');
  } else {
    log('Client smoke tests', 'WARN', 'some client tests failed (see output)');
  }
}

function runMigrations() {
  const main = run(
    'npx',
    ['node-pg-migrate', '--migrations-dir', 'migrations', 'up'],
    serverRoot,
  );
  if (main.status !== 0) {
    log('Migration run', 'FAIL', main.stderr?.trim() || main.stdout?.trim() || 'main migrations failed');
    return;
  }
  const moduleM1 = run(
    'npx',
    [
      'node-pg-migrate',
      '--migrations-dir',
      'migrations/modules/m1',
      '--migrations-table',
      'pgmigrations_m1',
      'up',
    ],
    serverRoot,
  );
  if (moduleM1.status === 0) {
    log('Migration run', 'PASS', 'node-pg-migrate up (core + m1 module)');
  } else {
    log('Migration run', 'FAIL', moduleM1.stderr?.trim() || moduleM1.stdout?.trim() || 'm1 module migrations failed');
  }
}

function printManualChecklist() {
  console.log('\n--- Manual E2E checklist (requires running stack) ---');
  const items = [
    'docker compose up -d db-primary db-replica',
    'cd packages/server && npm run migrate',
    'npm run dev (server :3000, client :5173)',
    'Login with badge + PIN (not auto-login)',
    'Create HRS entry → verify row in txn.prod_hrs',
    'Submit shift log → validation gate blocks bad data',
    'Supervisor approve → state APPROVED',
    'Handover → notes + attestation persisted',
    'Change request approve → entry updated (APPLIED)',
    'Admin Users → create user with line access',
    'Export CSV → file in tmp/exports + audit.export_job row',
    'Supervisor/Plant Head dashboards load real KPIs',
  ];
  items.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
}

function printPostPilot() {
  console.log('\n--- Post-pilot backlog ---');
  const items = [
    'SAP/PP&C integration (M1-06 Phase 2)',
    'Notification service (shift submit, holds)',
    'Async export for large jobs (>5000 rows)',
    'Read replica streaming replication (prod)',
    'Fix pre-existing property/platform test failures',
    'Remove authStore.unlockScreen mock PIN 1234',
    'Server tsc --noEmit cleanup (shiftLogRoutes, traceabilityRoutes)',
  ];
  items.forEach((item) => console.log(`  • ${item}`));
}

function printSummary() {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const warned = results.filter((r) => r.status === 'WARN').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n=== Pilot smoke summary: ${passed} pass, ${warned} warn, ${failed} fail ===`);
  if (failed > 0) process.exitCode = 1;
}

console.log('Zedral M1 — Pilot Smoke Test\n');

checkEnvFiles();
checkCriticalFiles();

const dbUp = await checkDatabase();

if (runMigrate && dbUp) {
  runMigrations();
} else if (runMigrate) {
  log('Migration run', 'WARN', 'skipped — database not available');
}

if (!skipTests) {
  runBatchTests();
  runClientSmoke();
}

printManualChecklist();
printPostPilot();
printSummary();
