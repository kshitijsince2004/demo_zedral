#!/usr/bin/env node
/**
 * Golden API snapshots — capture canonical JSON for invisibility diffs.
 *
 * Usage:
 *   node scripts/golden-api-snapshot.mjs              # write baseline/
 *   node scripts/golden-api-snapshot.mjs --out=actual # write actual/ (for diff)
 *
 * Requires API + seeded users (same as api-smoke).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.API_BASE || 'http://127.0.0.1:3005';
const MH_BADGE = process.env.SMOKE_MH_BADGE || '2000';
const MH_PIN = process.env.SMOKE_MH_PIN || '1234';
const ADMIN_BADGE = process.env.SMOKE_ADMIN_BADGE || '1000';
const ADMIN_PIN = process.env.SMOKE_ADMIN_PIN || '1234';
const TRACE_Q = process.env.GOLDEN_TRACE_Q || 'TEST';

const outArg = process.argv.find((a) => a.startsWith('--out='));
const outName = outArg ? outArg.slice('--out='.length) : 'baseline';
const OUT_DIR = path.join(__dirname, 'golden', outName);

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

function canonicalize(data) {
  return `${JSON.stringify(sortKeys(data), null, 2)}\n`;
}

async function req(method, urlPath, { body, token } = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token
        ? { Authorization: `Bearer ${token}`, 'st-auth-mode': 'header' }
        : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  const headers = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { status: res.status, data, headers };
}

async function badgeLogin(badgeId, pin) {
  const r = await req('POST', '/auth/badge-pin', { body: { badgeId, pin } });
  const token = r.headers['st-access-token'] || r.data?.accessToken || null;
  return { ...r, token };
}

function writeSnap(name, payload) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(file, canonicalize(payload));
  console.log(`wrote ${file}`);
}

async function main() {
  console.log(`Golden API snapshot → ${BASE} → golden/${outName}\n`);

  const health = await req('GET', '/health');
  if (health.status !== 200) {
    console.error('API not healthy; cannot capture golden snapshots');
    process.exit(1);
  }

  const mh = await badgeLogin(MH_BADGE, MH_PIN);
  const admin = await badgeLogin(ADMIN_BADGE, ADMIN_PIN);
  if (!mh.token || !admin.token) {
    console.error('Login failed; need seeded badge users');
    process.exit(1);
  }

  const snaps = [
    ['health', await req('GET', '/health')],
    ['queue_ann', await req('GET', '/stations/ann/queue?limit=50', { token: mh.token })],
    ['queue_crs', await req('GET', '/stations/crs/queue?limit=50', { token: mh.token })],
    ['queue_ctl', await req('GET', '/stations/ctl/queue?limit=50', { token: mh.token })],
    ['live_snapshot', await req('GET', '/live/snapshot', { token: mh.token })],
    ['plant_head', await req('GET', '/reports/plant-head', { token: admin.token })],
    [
      'traceability',
      await req('GET', `/traceability?q=${encodeURIComponent(TRACE_Q)}`, {
        token: admin.token,
      }),
    ],
  ];

  const exportPost = await req(
    'POST',
    '/exports',
    { body: { scope: { processId: 'HRS' }, format: 'CSV' }, token: mh.token },
  );
  snaps.push(['export_create', exportPost]);

  for (const [name, r] of snaps) {
    writeSnap(name, { status: r.status, body: r.data });
  }

  console.log(`\nDone: ${snaps.length} snapshots in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
