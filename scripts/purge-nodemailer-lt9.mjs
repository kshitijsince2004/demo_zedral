#!/usr/bin/env node
/**
 * Remove nested nodemailer copies older than 9.x (Trivy HIGH GHSA-p6gq-j5cr-w38f).
 * Overrides + rm after npm ci are not enough — npm prune can reintroduce 8.x under
 * supertokens-node.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('node_modules');
const removed = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const full = path.join(dir, ent.name);
    if (ent.name === 'nodemailer') {
      let ver = '?';
      try {
        ver = JSON.parse(fs.readFileSync(path.join(full, 'package.json'), 'utf8')).version;
      } catch {
        /* ignore */
      }
      const major = Number(String(ver).split('.')[0]);
      if (!Number.isFinite(major) || major < 9) {
        fs.rmSync(full, { recursive: true, force: true });
        removed.push(`${full} (${ver})`);
      }
      continue;
    }
    if (ent.name === '.bin') continue;
    walk(full);
  }
}

if (fs.existsSync(root)) walk(root);

if (removed.length) {
  console.log('purged nodemailer <9:', removed.join('; '));
} else {
  console.log('purge-nodemailer-lt9: nothing to remove');
}

// Prefer root (or workspace-hoisted) nodemailer 9.x
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'nodemailer', 'package.json'), 'utf8'));
  if (!String(pkg.version).startsWith('9.')) {
    console.error(`root nodemailer must be 9.x, got ${pkg.version}`);
    process.exit(1);
  }
  console.log('nodemailer ok', pkg.version);
} catch (e) {
  console.error('nodemailer 9.x missing after purge:', e.message);
  process.exit(1);
}
