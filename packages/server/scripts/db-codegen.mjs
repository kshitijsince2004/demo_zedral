/**
 * Regenerate Kysely types from the migrated DB, or run a drift guard.
 *
 *   node scripts/db-codegen.mjs           # write src/db-types.ts via kysely-codegen
 *   node scripts/db-codegen.mjs --check   # fail on known stale symbols (lineage_ref)
 *
 * Full `--verify` against this hand-maintained file is deferred until a dedicated
 * codegen adoption PR (schema-qualified names vs kysely-codegen defaults).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveDatabaseUrl } from './lib/database-url.mjs';

const check = process.argv.includes('--check');
const outFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db-types.ts');

if (check) {
  const src = fs.readFileSync(outFile, 'utf8');
  const banned = ['"audit.lineage_ref"', 'export interface AuditLineageRef'];
  const hits = banned.filter((s) => src.includes(s));
  if (hits.length) {
    console.error('db-types drift: remove stale symbols:', hits.join(', '));
    process.exit(1);
  }
  for (const required of ['"txn.manual_reroll_session"', '"txn.prod_hrs_slit"', 'planned_weight_mt']) {
    if (!src.includes(required)) {
      console.error(`db-types drift: missing ${required}`);
      process.exit(1);
    }
  }
  console.log('db-types guard OK');
  process.exit(0);
}

const url = resolveDatabaseUrl();
const result = spawnSync(
  'npx',
  [
    'kysely-codegen',
    '--dialect', 'postgres',
    '--out-file', outFile,
    '--url', url,
    '--type-only-imports',
    '--exclude-pattern', '{pgmigrations,pgmigrations_m1,spatial_ref_sys}',
  ],
  { stdio: 'inherit', shell: true, env: { ...process.env, DATABASE_URL: url } },
);
process.exit(result.status ?? 1);
