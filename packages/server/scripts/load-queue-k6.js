/**
 * k6 load: process queue poll (ANN) at operator cadence.
 *
 * Prerequisites: k6 installed; API up; set API_BASE + ACCESS_TOKEN
 *   (or BADGE_ID/PIN — k6 setup will login).
 *
 *   k6 run packages/server/scripts/load-queue-k6.js
 *
 * Records p95 on http_req_duration for GET /stations/ann/queue.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.API_BASE || 'http://127.0.0.1:3005';
const QUEUE_PATH = __ENV.QUEUE_PATH || '/stations/ann/queue?limit=50';
const POLL_S = Number(__ENV.POLL_S || 15);

export const options = {
  scenarios: {
    operators: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 30),
      duration: __ENV.DURATION || '2m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

export function setup() {
  if (__ENV.ACCESS_TOKEN) return { token: __ENV.ACCESS_TOKEN };
  const badge = __ENV.BADGE_ID || '2000';
  const pin = __ENV.PIN || '1234';
  const res = http.post(
    `${BASE}/auth/badge-pin`,
    JSON.stringify({ badgeId: badge, pin }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const body = res.json();
  const token = res.headers['St-Access-Token'] || body?.accessToken;
  if (!token) {
    throw new Error(`login failed: ${res.status} ${res.body}`);
  }
  return { token };
}

export default function (data) {
  const res = http.get(`${BASE}${QUEUE_PATH}`, {
    headers: {
      Authorization: `Bearer ${data.token}`,
      'st-auth-mode': 'header',
    },
  });
  check(res, { 'queue 200': (r) => r.status === 200 });
  sleep(POLL_S);
}
