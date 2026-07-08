#!/usr/bin/env node
const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: 80, path: '/api' + path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
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
    const req = http.request({ hostname: '127.0.0.1', port: 80, path: '/api' + path, method: 'GET', headers: token ? { Authorization: 'Bearer ' + token } : {} }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  let token = null;
  for (const b of ['1000', '2000', '3000', '4000', '5000']) {
    for (const p of ['1234', '5678', '4321', '0000', '1111']) {
      const r = await post('/auth/badge-pin', { badgeId: b, pin: p });
      if (r.data?.accessToken) {
        console.log('LOGIN', b, p);
        token = r.data.accessToken;
        break;
      }
    }
    if (token) break;
  }
  if (!token) {
    console.error('NO_TOKEN');
    process.exit(1);
  }

  const snap = await get('/live/snapshot', token);
  console.log('SNAPSHOT_KPIS', JSON.stringify(snap.data?.kpis, null, 2));

  const plant = await get('/reports/plant-head?window=7', token);
  console.log('PLANT_TODAY', plant.data?.kpiStrip?.productionTodayMt);
  console.log('PLANT_OEE', plant.data?.kpiStrip?.oeePct);

  const shift = await get('/shift-logs/active/6HI?date=2026-07-07&shift=B', token);
  console.log('ACTIVE_SHIFT', JSON.stringify(shift.data, null, 2));

  if (shift.data?.shiftLogId) {
    const sum = await get('/6hi/shift-summary/' + shift.data.shiftLogId + '?machine=6HI', token);
    console.log('SHIFT_SUMMARY', JSON.stringify(sum.data, null, 2));
  }
})();
