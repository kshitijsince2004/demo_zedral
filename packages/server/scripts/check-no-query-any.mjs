#!/usr/bin/env node
/**
 * Fail if Kysely query-builder table args are cast with `as any`
 * (selectFrom|updateTable|insertInto|deleteFrom). Audit M-4 guard.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const pattern = /\b(selectFrom|updateTable|insertInto|deleteFrom)\s*\([^)]*\bas\s+any\b/;

function collectTs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTs(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of collectTs(srcRoot)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (pattern.test(line)) {
      violations.push(`${path.relative(srcRoot, file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length) {
  console.error('Forbidden Kysely table `as any` casts:\n' + violations.join('\n'));
  process.exit(1);
}

console.log('lint:query-any OK');
