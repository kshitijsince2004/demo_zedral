#!/usr/bin/env node
/**
 * PERF verify smoke: MH live board, shift review, sync/batch drain.
 * Requires API on :3005 + seeded badge users.
 *
 * Usage: node --env-file=../../.env scripts/smoke-perf-verify.mjs
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.API_BASE || 'http://127.0.0.1:3005';
/** Pilot seed: machinehead = 4000 (SEED_PIN may be 5678); operator = 3000 / 1234 */
const MH_BADGE = process.env.SMOKE_MH_BADGE || '4000';
const MH_PIN = process.env.SMOKE_MH_PIN || '5678';
const OP_BADGE = process.env.SMOKE_OP_BADGE || '3000';
const OP_PIN = process.env.SMOKE_OP_PIN || '1234';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

async function req(method, urlPath, { body, token, headers } = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}`, 'st-auth-mode': 'header' } : {}),
      ...(headers || {}),
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
  const outHeaders = {};
  res.headers.forEach((v, k) => {
    outHeaders[k.toLowerCase()] = v;
  });
  return { status: res.status, data, headers: outHeaders };
}

async function badgeLogin(badgeId, pin) {
  const r = await req('POST', '/auth/badge-pin', { body: { badgeId, pin } });
  const token = r.headers['st-access-token'] || r.data?.accessToken || null;
  return { ...r, token };
}

async function main() {
  console.log(`PERF verify smoke → ${BASE}\n`);

  const migrate = spawnSync(
    process.execPath,
    [path.join(__dirname, 'apply-shift-log-index.mjs')],
    {
      cwd: path.join(__dirname, '..'),
      env: process.env,
      encoding: 'utf8',
    },
  );
  process.stdout.write(migrate.stdout || '');
  process.stderr.write(migrate.stderr || '');
  check('Apply migration 1971000000000', migrate.status === 0, `exit=${migrate.status}`);

  const health = await req('GET', '/health');
  check('GET /health', health.status === 200 && health.data?.status === 'ok', `http=${health.status}`);

  const mhLogin = await badgeLogin(MH_BADGE, MH_PIN);
  const mhToken = mhLogin.token;
  check(
    `MH badge-pin ${MH_BADGE}`,
    mhLogin.status === 200 && !!mhToken,
    `http=${mhLogin.status} err=${mhLogin.data?.error || ''}`,
  );
  if (!mhToken) {
    console.log(`\nfailures=${failed} (cannot continue without MH token)`);
    process.exit(1);
  }

  for (const p of ['/live/snapshot', '/live/machines', '/live/machine-head-dashboard']) {
    const r = await req('GET', p, { token: mhToken });
    const ok = r.status === 200;
    let detail = `http=${r.status}`;
    if (p === '/live/machines' && Array.isArray(r.data)) detail = `machines=${r.data.length}`;
    else if (p === '/live/machines' && Array.isArray(r.data?.machines)) {
      detail = `machines=${r.data.machines.length}`;
    } else if (p === '/live/machine-head-dashboard' && r.data && typeof r.data === 'object') {
      detail = `keys=${Object.keys(r.data).slice(0, 6).join(',')}`;
    } else if (!ok) {
      detail = `http=${r.status} err=${r.data?.error || ''}`;
    }
    check(`MH live ${p}`, ok, detail);
  }

  const logs = await req('GET', '/shift-logs', { token: mhToken });
  const list = Array.isArray(logs.data)
    ? logs.data
    : logs.data?.logs ?? logs.data?.items ?? logs.data?.shiftLogs ?? [];
  check(
    'GET /shift-logs',
    logs.status === 200,
    `http=${logs.status} count=${Array.isArray(list) ? list.length : typeof logs.data}`,
  );

  let reviewOk = false;
  let reviewDetail = 'no shift log id';
  if (Array.isArray(list) && list.length > 0) {
    const id = list[0].id ?? list[0].shiftLogId ?? list[0].shift_log_id ?? null;
    if (id) {
      const review = await req('GET', `/shift-logs/${id}/review`, { token: mhToken });
      reviewOk = review.status === 200;
      reviewDetail = `id=${id} http=${review.status} completed=${review.data?.completedOrders?.length ?? 'n/a'}`;
      if (!reviewOk) reviewDetail += ` err=${review.data?.error || ''}`;
    }
  } else {
    const probe = await req('GET', '/shift-logs/00000000-0000-4000-8000-000000000001/review', {
      token: mhToken,
    });
    reviewOk = probe.status === 404 || probe.status === 400 || probe.status === 403;
    reviewDetail = `empty/non-array list; probe http=${probe.status}`;
  }
  check('GET /shift-logs/:id/review', reviewOk, reviewDetail);

  const opLogin = await badgeLogin(OP_BADGE, OP_PIN);
  let opToken = opLogin.token;
  check(
    `Operator badge-pin ${OP_BADGE}`,
    opLogin.status === 200 && !!opToken,
    `http=${opLogin.status} err=${opLogin.data?.error || ''}`,
  );
  if (!opToken) {
    opToken = mhToken;
    console.log('  (using MH token for batch drain)');
  }

  const aggA = `smoke:aggA:${Date.now()}`;
  const aggB = `smoke:aggB:${Date.now()}`;
  const id1 = randomUUID();
  const id2 = randomUUID();
  const id3 = randomUUID();

  const batch1 = await req('POST', '/sync/batch', {
    token: opToken,
    body: {
      items: [
        { id: id1, method: 'POST', url: '/crew', aggregateKey: aggA, payload: {} },
        { id: id2, method: 'POST', url: '/crew', aggregateKey: aggA, payload: { shiftLogId: 'x' } },
        { id: id3, method: 'POST', url: '/crew', aggregateKey: aggB, payload: {} },
      ],
    },
  });

  const results = batch1.data?.results;
  check(
    'POST /sync/batch accepts backlog',
    batch1.status === 200 && Array.isArray(results) && results.length === 3,
    `http=${batch1.status} n=${results?.length} err=${batch1.data?.error || ''}`,
  );

  if (Array.isArray(results) && results.length === 3) {
    check(
      'Batch preserves aggregate stop (item2 skipped)',
      results[0].status >= 400 && results[1].skipped === true && results[1].status === 0,
      JSON.stringify(
        results.map((r) => ({ id: r.id.slice(0, 8), status: r.status, skipped: !!r.skipped })),
      ),
    );
    check(
      'Batch continues other aggregate (item3 ran)',
      results[2].skipped !== true && results[2].status >= 400,
      `status=${results[2].status}`,
    );
  }

  const batch2 = await req('POST', '/sync/batch', {
    token: opToken,
    body: {
      items: [
        { id: id1, method: 'POST', url: '/crew', aggregateKey: aggA, payload: {} },
        { id: id2, method: 'POST', url: '/crew', aggregateKey: aggA, payload: { shiftLogId: 'x' } },
        { id: id3, method: 'POST', url: '/crew', aggregateKey: aggB, payload: {} },
      ],
    },
  });
  check(
    'POST /sync/batch re-send is safe',
    batch2.status === 200 && Array.isArray(batch2.data?.results) && batch2.data.results.length === 3,
    `http=${batch2.status}`,
  );

  console.log(`\n=== PERF verify: ${failed === 0 ? 'PASSED' : 'FAILED'} (failures=${failed}) ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
