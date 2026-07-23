import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { resolveDatabaseUrl } from './lib/database-url.mjs';
import { pickPrimaryRole, normalizeRoleName } from '@m1/shared-validation';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const API = process.env.API_BASE || `http://127.0.0.1:${process.env.PORT || 3006}`;
const PASSWORD = process.env.SEED_STAFF_PASSWORD || 'Password123!';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' â€” ' + detail : ''}`);
  if (!ok) failed += 1;
}

function decodeJwt(jwt) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
}

async function api(method, urlPath, { body, headers } = {}) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const outHeaders = {};
  res.headers.forEach((v, k) => { outHeaders[k.toLowerCase()] = v; });
  return { status: res.status, data, headers: outHeaders };
}

async function main() {
  console.log(`Supervisor smoke â†’ ${API}\n`);

  const client = new pg.Client({ connectionString: resolveDatabaseUrl(), connectionTimeoutMillis: 10000 });
  await client.connect();
  const role = await client.query("SELECT role_id, role_name FROM security.role WHERE role_name='SUPERVISOR'");
  const user = await client.query(`
    SELECT u.username, u.emp_code, u.supertokens_user_id, r.role_name
    FROM security.app_user u
    JOIN security.user_role ur ON ur.user_id = u.user_id
    JOIN security.role r ON r.role_id = ur.role_id
    WHERE u.username = 'supervisor'
  `);
  check('DB SUPERVISOR role exists', role.rows.length === 1, JSON.stringify(role.rows[0]));
  check('DB supervisor user role is SUPERVISOR', user.rows[0]?.role_name === 'SUPERVISOR', JSON.stringify(user.rows[0]));
  check('normalizeRoleName keeps SUPERVISOR', normalizeRoleName('SUPERVISOR') === 'SUPERVISOR');
  check('pickPrimaryRole is SUPERVISOR not MACHINE_HEAD', pickPrimaryRole(['SUPERVISOR']) === 'SUPERVISOR');
  await client.end();

  check('GET /health', (await api('GET', '/health')).status === 200);

  const signIn = await api('POST', '/auth/signin', {
    body: {
      formFields: [
        { id: 'email', value: 'supervisor@zedral.local' },
        { id: 'password', value: PASSWORD },
      ],
    },
  });
  const access = signIn.headers['st-access-token'];
  check('email/password supervisor sign-in', signIn.status === 200 && signIn.data?.status === 'OK' && !!access, `http=${signIn.status}`);

  let claims = {};
  if (access) {
    claims = decodeJwt(access);
    check(
      'JWT roles are SUPERVISOR only (not MACHINE_HEAD)',
      Array.isArray(claims.roles) && claims.roles.includes('SUPERVISOR') && !claims.roles.includes('MACHINE_HEAD'),
      JSON.stringify({ username: claims.username, roles: claims.roles }),
    );
    check('JWT username is supervisor', claims.username === 'supervisor', String(claims.username));
    check('pickPrimaryRole from JWT is SUPERVISOR', pickPrimaryRole(claims.roles) === 'SUPERVISOR');
  } else {
    check('JWT roles are SUPERVISOR only (not MACHINE_HEAD)', false, 'no access token');
  }

  const authHeaders = { authorization: `Bearer ${access}` };

  const allowed = [
    ['GET', '/live/snapshot'],
    ['GET', '/live/machines'],
    ['GET', '/live/machine-head-dashboard'],
    ['GET', '/traceability?q=TEST'],
    ['GET', '/traceability/suggest?q=TE'],
    ['GET', '/6hi/order-assignment'],
  ];
  for (const [method, p] of allowed) {
    const r = await api(method, p, { headers: authHeaders });
    const ok = r.status === 200 || (p.startsWith('/traceability?') && (r.status === 200 || r.status === 404));
    check(`ALLOW ${method} ${p}`, ok, `http=${r.status} err=${r.data?.error || ''}`);
  }

  const denied = [
    ['GET', '/users'],
    ['POST', '/master-data/grades', { grade_code: 'SUPERVISOR_DENY_TEST' }],
    ['GET', '/exports'],
    ['GET', '/audit'],
    ['GET', '/machine-crew'],
    ['POST', '/validation-rules', { name: 'x' }],
    ['GET', '/reports/machine-head'],
    ['PUT', '/shift-logs/1/approve'],
  ];
  for (const [method, p, body] of denied) {
    const r = await api(method, p, { headers: authHeaders, body });
    check(`DENY  ${method} ${p}`, r.status === 403, `http=${r.status} err=${r.data?.error || ''}`);
  }

  console.log(`\nfailures=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
