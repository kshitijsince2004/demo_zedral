#!/usr/bin/env node
/** API audit on EC2 localhost — run ON the server */
const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: 80, path: '/api' + path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 80, path: '/api' + path, method: 'GET',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  let token = null;
  for (const b of ['1000','2000','3000','4000','5000']) {
    for (const p of ['1234','5678','4321','0000']) {
      const r = await post('/auth/badge-pin', { badgeId: b, pin: p });
      if (r.data && r.data.accessToken) {
        console.log('LOGIN OK badge', b, 'pin', p);
        token = r.data.accessToken;
        break;
      }
    }
    if (token) break;
  }
  if (!token) { console.error('No login'); process.exit(1); }

  const endpoints = [
    '/shifts/current?machine=6HI',
    '/shift-logs/active/6HI?date=2026-07-07&shift=B',
    '/shift-logs/active/6HI',
    '/live/snapshot',
    '/reports/plant-head?window=7',
    '/6hi/active-order?machine=6HI',
    '/6hi/queue?machine=6HI&date=2026-07-07&shift=B&subProcess=ROLLING',
    '/6hi/queue?machine=6HI&date=2026-06-09&shift=B&subProcess=ROLLING',
    '/live/machines',
  ];

  for (const ep of endpoints) {
    const r = await get(ep, token);
    console.log('\n=== GET', ep, '→', r.status, '===');
    console.log(JSON.stringify(r.data, null, 2).slice(0, 3000));
  }

  const active = await get('/shift-logs/active/6HI?date=2026-07-07&shift=B', token);
  const sid = active.data && active.data.shiftLogId;
  if (sid) {
    const sum = await get('/6hi/shift-summary/' + sid + '?machine=6HI', token);
    console.log('\n=== shift-summary', sid, '===');
    console.log(JSON.stringify(sum.data, null, 2).slice(0, 2000));
  }
  const sid2 = '2';
  const sum2 = await get('/6hi/shift-summary/' + sid2 + '?machine=6HI', token);
  console.log('\n=== shift-summary 2 (June 9 log) ===');
  console.log(JSON.stringify(sum2.data, null, 2).slice(0, 2000));
}

main().catch((e) => { console.error(e); process.exit(1); });
