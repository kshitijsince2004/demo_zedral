#!/usr/bin/env node
/**
 * Re-capture golden snapshots and diff against baseline/.
 * Any non-empty diff exits 1 (blocks Phase 3 merges).
 *
 * Usage: node scripts/golden-api-diff.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(__dirname, 'golden', 'baseline');
const ACTUAL = path.join(__dirname, 'golden', 'actual');

const snap = spawnSync(
  process.execPath,
  [path.join(__dirname, 'golden-api-snapshot.mjs'), '--out=actual'],
  { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8' },
);
process.stdout.write(snap.stdout || '');
process.stderr.write(snap.stderr || '');
if (snap.status !== 0) {
  console.error('Snapshot capture failed');
  process.exit(snap.status || 1);
}

if (!fs.existsSync(BASELINE)) {
  console.error(`Missing baseline at ${BASELINE} — run golden-api-snapshot.mjs first`);
  process.exit(1);
}

const baselineFiles = fs.readdirSync(BASELINE).filter((f) => f.endsWith('.json')).sort();
const actualFiles = fs.readdirSync(ACTUAL).filter((f) => f.endsWith('.json')).sort();

let failed = 0;

const onlyBase = baselineFiles.filter((f) => !actualFiles.includes(f));
const onlyActual = actualFiles.filter((f) => !baselineFiles.includes(f));
for (const f of onlyBase) {
  console.error(`MISSING in actual: ${f}`);
  failed += 1;
}
for (const f of onlyActual) {
  console.error(`EXTRA in actual: ${f}`);
  failed += 1;
}

for (const f of baselineFiles.filter((x) => actualFiles.includes(x))) {
  const a = fs.readFileSync(path.join(BASELINE, f), 'utf8');
  const b = fs.readFileSync(path.join(ACTUAL, f), 'utf8');
  if (a !== b) {
    console.error(`DIFF: ${f}`);
    failed += 1;
  } else {
    console.log(`OK: ${f}`);
  }
}

if (failed > 0) {
  console.error(`\ngolden-api-diff: ${failed} difference(s)`);
  process.exit(1);
}
console.log('\ngolden-api-diff: clean');
