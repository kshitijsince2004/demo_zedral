#!/usr/bin/env node
/**
 * Live API smoke test — requires running server + seeded users.
 */
const BASE = process.env.API_BASE || 'http://localhost:3005';

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`API smoke test → ${BASE}\n`);

  const health = await req('GET', '/health');
  check('GET /health', health.status === 200, `status ${health.status}`);

  const badLogin = await req('POST', '/auth/badge-pin', { badgeId: '9999', pin: '0000' });
  check('POST /auth/badge-pin rejects bad creds', badLogin.status === 401);

  const supLogin = await req('POST', '/auth/badge-pin', { badgeId: '2000', pin: '1234' });
  check('POST /auth/badge-pin machine head', supLogin.status === 200 && !!supLogin.data.accessToken);
  const supToken = supLogin.data.accessToken;

  const adminLogin = await req('POST', '/auth/badge-pin', { badgeId: '1000', pin: '1234' });
  check('POST /auth/badge-pin admin', adminLogin.status === 200 && !!adminLogin.data.accessToken);
  const adminToken = adminLogin.data.accessToken;

  const reports = await req('GET', '/reports/machine-head', null, supToken);
  check(
    'GET /reports/machine-head',
    reports.status === 200 && Array.isArray(reports.data.lineStatuses),
    `pending=${reports.data.pendingReviewCount}`,
  );

  const plantHead = await req('GET', '/reports/plant-head', null, adminToken);
  check(
    'GET /reports/plant-head',
    plantHead.status === 200 && typeof plantHead.data.plantWideOee === 'number',
    `oee=${plantHead.data.plantWideOee}`,
  );

  const users = await req('GET', '/users', null, adminToken);
  check('GET /users (admin)', users.status === 200 && Array.isArray(users.data), `count=${users.data?.length}`);

  const exportJob = await req(
    'POST',
    '/exports',
    { scope: { processId: 'HRS' }, format: 'CSV' },
    supToken,
  );
  check(
    'POST /exports',
    exportJob.status === 201 || exportJob.status === 200,
    exportJob.data?.status || exportJob.data?.error,
  );

  const daily = await req('GET', '/reports/daily', null, supToken);
  check(
    'GET /reports/daily',
    daily.status === 200 && typeof daily.data.totalProductionMt === 'number',
    `prod=${daily.data.totalProductionMt} MT`,
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== API smoke: ${results.length - failed}/${results.length} passed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
