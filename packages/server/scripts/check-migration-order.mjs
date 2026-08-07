#!/usr/bin/env node
/**
 * Fail if migration filenames are not strictly increasing by timestamp prefix,
 * or if two files share the same timestamp prefix (collision risk).
 * Historical duplicates are listed in ALLOWED_DUPLICATE_PREFIXES.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roots = [
  path.join(__dirname, '../migrations'),
  path.join(__dirname, '../migrations/modules/m1'),
];

/** Known collisions already applied in prod/QA — do not add new ones. */
const ALLOWED_DUPLICATE_PREFIXES = new Set([
  '1970000000000', // manual_reroll_hold_not_blocking + order_journey_tenant_id
]);

function listMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('.'))
    .map((f) => ({ file: f, prefix: f.split('_')[0], dir }));
}

let failed = false;
for (const dir of roots) {
  const files = listMigrations(dir).sort((a, b) => a.file.localeCompare(b.file));
  const byPrefix = new Map();
  for (const m of files) {
    if (!/^\d+$/.test(m.prefix)) {
      console.error(`Bad migration name (no numeric prefix): ${path.join(dir, m.file)}`);
      failed = true;
      continue;
    }
    const list = byPrefix.get(m.prefix) || [];
    list.push(m.file);
    byPrefix.set(m.prefix, list);
  }
  for (const [prefix, names] of byPrefix) {
    if (names.length > 1 && !ALLOWED_DUPLICATE_PREFIXES.has(prefix)) {
      console.error(`Duplicate migration timestamp ${prefix}: ${names.join(', ')}`);
      failed = true;
    }
  }
  for (let i = 1; i < files.length; i++) {
    if (files[i].file < files[i - 1].file) {
      console.error(`Out-of-order after sort anomaly: ${files[i - 1].file} → ${files[i].file}`);
      failed = true;
    }
  }
  console.log(`OK ${files.length} migrations in ${path.relative(process.cwd(), dir) || dir}`);
}

if (failed) process.exit(1);
console.log('Migration order check passed.');
