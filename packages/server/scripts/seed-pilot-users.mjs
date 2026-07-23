#!/usr/bin/env node
/**
 * Seeds pilot dev users for local E2E testing.
 * All users use PIN 1234. Idempotent (ON CONFLICT / IF NOT EXISTS).
 */
import pg from 'pg';
import { scryptSync, randomBytes } from 'node:crypto';
import supertokens from 'supertokens-node';
import EmailPassword from 'supertokens-node/recipe/emailpassword/index.js';
import { resolveDatabaseUrl } from './lib/database-url.mjs';
import { seedMachines } from './seed-machines.mjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const DATABASE_URL = resolveDatabaseUrl();

supertokens.init({
  framework: 'express',
  supertokens: {
    connectionURI: process.env.SUPERTOKENS_CORE_URI || 'http://localhost:3567',
    apiKey: process.env.SUPERTOKENS_API_KEY || 'local_development_key',
  },
  appInfo: {
    appName: 'Zedral M1',
    apiDomain: process.env.API_DOMAIN || 'http://localhost:3005',
    websiteDomain: process.env.WEBSITE_DOMAIN || 'http://localhost:5173',
  },
  recipeList: [EmailPassword.init()],
});

/** Must match packages/server/src/services/pinService.ts scrypt parameters. */
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Staff email/password for SuperTokens EmailPassword (roles 3/4/5). */
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD || 'Password123!';

const USERS = [
  { username: 'admin', emp_code: '1000', full_name: 'Plant Admin', role_id: 4, lines: [], machines: [], staff: true },
  { username: 'operator', emp_code: '3000', full_name: 'Shift Operator', role_id: 1, lines: ['HRS', 'ROLLING'], machines: ['6HI'] },
  { username: 'operator4hi', emp_code: '3004', full_name: '4HI Operator', role_id: 1, lines: ['ROLLING'], machines: ['4HI'] },
  { username: 'operator2hi', emp_code: '3002', full_name: '2HI Operator', role_id: 1, lines: ['ROLLING'], machines: ['2HI'] },
  { username: 'machinehead', emp_code: '4000', full_name: 'Machine Head', role_id: 5, lines: ['ROLLING', '4HI', '2HI'], machines: ['6HI', '4HI', '2HI'], staff: true },
  { username: 'supervisor', emp_code: '4500', full_name: 'Supervisor', role_id: 2, lines: [], machines: [], staff: true },
  { username: 'planthead', emp_code: '5000', full_name: 'Plant Head', role_id: 3, lines: ['HRS', 'PKL', 'CRM', 'ROLLING'], machines: [], staff: true },
];

const PIN = process.env.SEED_PIN || '1234';

function staffEmail(username) {
  return `${username}@zedral.local`;
}

/** Create or look up SuperTokens EmailPassword user; return ST user id. */
async function ensureStaffSuperTokensUser(username) {
  const email = staffEmail(username);
  try {
    const signedUp = await EmailPassword.signUp('', email, STAFF_PASSWORD);
    if (signedUp.status === 'OK') return signedUp.user.id;
    if (signedUp.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
      const existing = await supertokens.listUsersByAccountInfo('', { email });
      const id = existing?.[0]?.id;
      if (id) return id;
      console.warn(`SuperTokens user exists for ${email} but id could not be resolved`);
    }
  } catch (err) {
    console.error(`Failed to ensure SuperTokens user for ${email}:`, err?.message ?? err);
  }
  return null;
}

/** @param {pg.Client} client */
async function seedRoles(client) {
  await client.query(`
    INSERT INTO security.role (role_id, role_name, description) VALUES
      (1, 'OPERATOR', 'Line Operator: Can submit shift logs'),
      (2, 'SUPERVISOR', 'Oversight: live dashboards, import, traceability, assignment'),
      (3, 'PLANT_HEAD', 'Plant Head: View all reports'),
      (4, 'ADMIN', 'System Administrator: Manage master data'),
      (5, 'MACHINE_HEAD', 'Machine Head: Manages assigned machines')
    ON CONFLICT (role_id) DO UPDATE
      SET role_name = EXCLUDED.role_name,
          description = EXCLUDED.description;
  `);
}

export async function seedPilotUsers(databaseUrl = DATABASE_URL) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const pinHash = hashPin(PIN);
  await seedRoles(client);
  await seedMachines(client);

  const tenant = await client.query(
    `SELECT tenant_id FROM security.tenant_config LIMIT 1`,
  );
  const tenantId = tenant.rows[0]?.tenant_id;
  if (!tenantId) {
    throw new Error('No tenant found — run migrations first');
  }

  const userIds = {};

  for (const u of USERS) {
    const existing = await client.query(
      `SELECT user_id, supertokens_user_id FROM security.app_user WHERE emp_code = $1`,
      [u.emp_code],
    );

    let userId;
    let stUserId = existing.rows[0]?.supertokens_user_id ?? null;
    if (u.staff) {
      // Always resolve by email so re-seed repairs wrong/shared SuperTokens links.
      stUserId = await ensureStaffSuperTokensUser(u.username);
      if (!stUserId) {
        console.warn(`Warning: could not resolve SuperTokens user for ${staffEmail(u.username)}`);
      } else {
        // Enforce 1:1 — clear this ST id from any other app_user first.
        await client.query(
          `UPDATE security.app_user
           SET supertokens_user_id = NULL
           WHERE supertokens_user_id = $1
             AND emp_code IS DISTINCT FROM $2`,
          [stUserId, u.emp_code],
        );
      }
    }

    if (existing.rows.length > 0) {
      userId = existing.rows[0].user_id;
      await client.query(
        `UPDATE security.app_user
         SET pin_hash = $1, status = 'ACTIVE', pin_failed_attempts = 0, pin_locked_until = NULL,
             supertokens_user_id = COALESCE($3, supertokens_user_id)
         WHERE user_id = $2`,
        [pinHash, userId, stUserId],
      );
      console.log(`Updated user ${u.emp_code} (${u.username})${u.staff ? ` → ${staffEmail(u.username)}` : ''}`);
    } else {
      const inserted = await client.query(
        `INSERT INTO security.app_user (username, full_name, emp_code, status, pin_hash, supertokens_user_id)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5)
         RETURNING user_id`,
        [u.username, u.full_name, u.emp_code, pinHash, stUserId],
      );
      userId = inserted.rows[0].user_id;
      console.log(`Created user ${u.emp_code} (${u.username})${u.staff ? ` → ${staffEmail(u.username)}` : ''}`);
    }

    let roleId = u.role_id;
    if (u.role_name) {
      const roleRow = await client.query(
        `SELECT role_id FROM security.role WHERE role_name = $1`,
        [u.role_name],
      );
      roleId = roleRow.rows[0]?.role_id;
      if (!roleId) {
        throw new Error(`Role not found: ${u.role_name} — run migrations first`);
      }
    }

    // Replace role so re-seed corrects stale assignments (e.g. SUPERVISOR mistaken for MACHINE_HEAD).
    await client.query(`DELETE FROM security.user_role WHERE user_id = $1`, [userId]);
    await client.query(
      `INSERT INTO security.user_role (user_id, role_id) VALUES ($1, $2)`,
      [userId, roleId],
    );

    for (const line of u.lines) {
      const proc = await client.query(
        `SELECT process_id FROM master.process WHERE code = $1`,
        [line],
      );
      if (proc.rows.length === 0) continue;
      await client.query(
        `INSERT INTO security.line_access (user_id, process_id, access_level)
         VALUES ($1, $2, 'WRITE')
         ON CONFLICT DO NOTHING`,
        [userId, proc.rows[0].process_id],
      );
    }

    for (const machine of u.machines ?? []) {
      await client.query(
        `INSERT INTO security.machine_access (user_id, machine_code)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, machine],
      );
    }

    userIds[u.username] = userId;
  }

  await client.end();
  return { pin: PIN, staffPassword: STAFF_PASSWORD, users: USERS, userIds };
}

const isMain = process.argv[1]?.includes('seed-pilot-users');
if (isMain) {
  seedPilotUsers()
    .then((result) => {
      console.log(`\nPilot users ready (operator PIN: ${result.pin}):`);
      for (const u of result.users) {
        if (u.staff) {
          console.log(`  Staff  ${staffEmail(u.username)} / ${result.staffPassword} — ${u.full_name}`);
        } else {
          console.log(`  Badge  ${u.emp_code} / PIN ${result.pin} — ${u.full_name}`);
        }
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
