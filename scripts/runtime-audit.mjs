#!/usr/bin/env node
/**
 * Runtime audit — production API + optional local DB.
 * Usage: node scripts/runtime-audit.mjs [--base https://hsl.zedral.com]
 */
const BASE = (process.argv.find((a) => a.startsWith('--base='))?.slice(7))
  || process.env.API_BASE
  || 'https://hsl.zedral.com';

const API = `${BASE.replace(/\/$/, '')}/api`;

async function req(method, path, body, token) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, url };
}

function section(title) {
  console.log(`\n${'='.repeat(60)}\n${title}\n${'='.repeat(60)}`);
}

function printJson(label, obj) {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(obj, null, 2));
}

async function login(badgeId, pin) {
  const r = await req('POST', '/auth/badge-pin', { badgeId, pin });
  if (r.status !== 200) throw new Error(`Login ${badgeId} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.accessToken;
}

async function main() {
  section(`RUNTIME AUDIT → ${API}`);

  const health = await req('GET', '/health');
  printJson('GET /health', health);

  const badges = [
    { id: '5000', role: 'PLANT_HEAD' },
    { id: '4000', role: 'MACHINE_HEAD' },
    { id: '3000', role: 'OPERATOR' },
    { id: '1000', role: 'ADMIN' },
  ];

  const tokens = {};
  for (const b of badges) {
    try {
      tokens[b.role] = await login(b.id, process.env.SEED_PIN || '1234');
      console.log(`✓ Login badge ${b.id} (${b.role})`);
    } catch (e) {
      console.log(`✗ Login badge ${b.id} (${b.role}): ${e.message}`);
    }
  }

  const admin = tokens.ADMIN || tokens.PLANT_HEAD;
  const plant = tokens.PLANT_HEAD || admin;
  const operator = tokens.OPERATOR || admin;
  const machineHead = tokens.MACHINE_HEAD || admin;

  if (!plant) {
    console.error('No token — cannot continue');
    process.exit(1);
  }

  section('STEP 2 — API Responses');

  const endpoints = [
    { name: 'plant-head', path: '/reports/plant-head?window=7', token: plant },
    { name: 'live-snapshot', path: '/live/snapshot', token: plant },
    { name: 'live-machines', path: '/live/machines', token: plant },
    { name: 'live-orders', path: '/live/orders', token: plant },
    { name: 'machine-head-dashboard', path: '/live/machine-head-dashboard', token: machineHead },
    { name: '6hi-active-order-6HI', path: '/6hi/active-order?machine=6HI', token: operator },
    { name: '6hi-queue-6HI', path: '/6hi/queue?machine=6HI&date=2026-07-07&shift=B&subProcess=ROLLING', token: operator },
    { name: 'shift-active-6HI', path: '/shift-logs/active/6HI', token: operator },
  ];

  const results = {};
  for (const ep of endpoints) {
    const r = await req('GET', ep.path, null, ep.token);
    results[ep.name] = r;
    console.log(`\n[${ep.name}] ${r.status} ${r.url}`);
    if (r.status !== 200) {
      console.log(JSON.stringify(r.data).slice(0, 500));
    } else {
      const preview = JSON.stringify(r.data);
      console.log(preview.length > 2000 ? preview.slice(0, 2000) + '...' : preview);
    }
  }

  section('STEP 6 — KPI Cross-check');

  const plantHead = results['plant-head']?.data;
  const snapshot = results['live-snapshot']?.data;
  const shiftActive = results['shift-active-6HI']?.data;

  if (plantHead?.kpiStrip) {
    printJson('Plant KPI Strip', plantHead.kpiStrip);
  }
  if (snapshot?.kpis) {
    printJson('Live Snapshot KPIs', snapshot.kpis);
  }
  if (shiftActive) {
    printJson('Active Shift Log (6HI)', shiftActive);
  }

  const shiftLogId = shiftActive?.shiftLogId ?? shiftActive?.shift_log_id;
  if (shiftLogId && operator) {
    const summary = await req('GET', `/6hi/shift-summary/${shiftLogId}?machine=6HI`, null, operator);
    printJson(`GET /6hi/shift-summary/${shiftLogId}`, { status: summary.status, data: summary.data });
  }

  section('STEP 2b — In-progress orders from DB via API');

  const orders = results['live-orders']?.data?.orders ?? [];
  const inProgress = orders.filter((o) => o.status === 'IN_PROGRESS' || o.status === 'STOPPAGE');
  printJson('IN_PROGRESS/STOPPAGE orders', inProgress);

  const machines = results['live-machines']?.data ?? snapshot?.machines ?? [];
  printJson('Machine statuses', machines.map((m) => ({
    code: m.machineCode,
    status: m.status,
    order: m.currentOrder,
    weight: m.productionWeightMt,
    progress: m.shiftProgressPct,
  })));

  section('SUMMARY — Mismatches');
  const prodTodayPlant = plantHead?.kpiStrip?.productionTodayMt ?? 'N/A';
  const prodTodayLive = snapshot?.kpis?.productionTodayMt ?? 'N/A';
  const shiftProdLive = snapshot?.kpis?.shiftProductionMt ?? 'N/A';
  const producedShift = shiftActive?.producedMt ?? 'N/A';

  console.log(`Production Today (plant-head):     ${prodTodayPlant}`);
  console.log(`Production Today (live snapshot):  ${prodTodayLive}`);
  console.log(`Shift Production (live snapshot):  ${shiftProdLive}`);
  console.log(`Produced MT (active shift log):    ${producedShift}`);
  console.log(`Running machines (snapshot):       ${snapshot?.kpis?.runningMachines ?? 'N/A'}`);
  console.log(`Machines RUNNING count:            ${machines.filter((m) => m.status === 'RUNNING').length}`);

  if (prodTodayPlant === 0 && (shiftProdLive > 0 || producedShift > 0)) {
    console.log('\n⚠ MISMATCH: Plant-head shows 0 but shift has production');
  }
  if (snapshot?.kpis?.runningMachines === 0 && inProgress.length > 0) {
    console.log('\n⚠ MISMATCH: Live snapshot shows 0 running but orders IN_PROGRESS exist');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
