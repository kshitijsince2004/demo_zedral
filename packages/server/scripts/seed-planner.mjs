#!/usr/bin/env node
/**
 * Seed Planning-Lite account (PLANNER role) — import-only.
 * Idempotent upsert by emp_code / email.
 */
import pg from 'pg';
import { scryptSync, randomBytes } from 'node:crypto';
import supertokens from 'supertokens-node';
import EmailPassword from 'supertokens-node/recipe/emailpassword/index.js';
import { resolveDatabaseUrl } from './lib/database-url.mjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const DATABASE_URL = resolveDatabaseUrl();
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD || 'Password123!';
const PIN = process.env.SEED_PIN || '1234';
const EMAIL = 'planning@zedral.local';
const USERNAME = 'planning';
const EMP_CODE = '4600';
const LINES = ['HRS', 'PKL', 'ANN', 'RWD', 'CTL'];

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

supertokens.init({
  framework: 'express',
  supertokens: {
    connectionURI: process.env.SUPERTOKENS_CORE_URI || 'http://localhost:3567',
    apiKey: process.env.SUPERTOKENS_API_KEY || 'local-development-key',
  },
  appInfo: {
    appName: 'Zedral M1',
    apiDomain: process.env.API_DOMAIN || 'http://localhost:3005',
    websiteDomain: process.env.WEBSITE_DOMAIN || 'http://localhost:5173',
  },
  recipeList: [EmailPassword.init()],
});

async function ensureStaffSuperTokensUser() {
  try {
    const signedUp = await EmailPassword.signUp('', EMAIL, STAFF_PASSWORD);
    if (signedUp.status === 'OK') return signedUp.user.id;
    if (signedUp.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
      const existing = await supertokens.listUsersByAccountInfo('', { email: EMAIL });
      return existing?.[0]?.id ?? null;
    }
  } catch (err) {
    console.error(`Failed to ensure SuperTokens user for ${EMAIL}:`, err?.message ?? err);
  }
  return null;
}

async function main() {
  console.log('=== Zedral Planning-Lite Seed ===\n');
  console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  await client.query(`
    INSERT INTO security.role (role_id, role_name, description)
    VALUES (7, 'PLANNER', 'Planning-Lite: plan import only')
    ON CONFLICT (role_id) DO UPDATE
      SET role_name = EXCLUDED.role_name,
          description = EXCLUDED.description;
  `);

  const roleRow = await client.query(
    `SELECT role_id FROM security.role WHERE role_name = 'PLANNER'`,
  );
  const roleId = roleRow.rows[0]?.role_id;
  if (!roleId) throw new Error('PLANNER role missing after upsert');

  const stUserId = await ensureStaffSuperTokensUser();
  if (!stUserId) {
    console.warn(`Warning: could not resolve SuperTokens user for ${EMAIL}`);
  } else {
    await client.query(
      `UPDATE security.app_user
       SET supertokens_user_id = NULL
       WHERE supertokens_user_id = $1
         AND emp_code IS DISTINCT FROM $2`,
      [stUserId, EMP_CODE],
    );
  }

  const pinHash = hashPin(PIN);
  const existing = await client.query(
    `SELECT user_id FROM security.app_user WHERE emp_code = $1`,
    [EMP_CODE],
  );

  let userId;
  if (existing.rows.length > 0) {
    userId = existing.rows[0].user_id;
    await client.query(
      `UPDATE security.app_user
       SET username = $1, full_name = $2, status = 'ACTIVE', pin_hash = $3,
           pin_failed_attempts = 0, pin_locked_until = NULL,
           supertokens_user_id = COALESCE($4, supertokens_user_id)
       WHERE user_id = $5`,
      [USERNAME, 'Planning Lite', pinHash, stUserId, userId],
    );
    console.log(`Updated user ${EMP_CODE} (${USERNAME}) → ${EMAIL}`);
  } else {
    const inserted = await client.query(
      `INSERT INTO security.app_user (username, full_name, emp_code, status, pin_hash, supertokens_user_id)
       VALUES ($1, $2, $3, 'ACTIVE', $4, $5)
       RETURNING user_id`,
      [USERNAME, 'Planning Lite', EMP_CODE, pinHash, stUserId],
    );
    userId = inserted.rows[0].user_id;
    console.log(`Created user ${EMP_CODE} (${USERNAME}) → ${EMAIL}`);
  }

  await client.query(`DELETE FROM security.user_role WHERE user_id = $1`, [userId]);
  await client.query(
    `INSERT INTO security.user_role (user_id, role_id) VALUES ($1, $2)`,
    [userId, roleId],
  );

  await client.query(`DELETE FROM security.machine_access WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM security.line_access WHERE user_id = $1`, [userId]);

  for (const line of LINES) {
    const proc = await client.query(
      `SELECT process_id FROM master.process WHERE code = $1`,
      [line],
    );
    if (proc.rows.length === 0) {
      console.warn(`Warning: process ${line} not found — skip line_access`);
      continue;
    }
    await client.query(
      `INSERT INTO security.line_access (user_id, process_id, access_level)
       VALUES ($1, $2, 'WRITE')
       ON CONFLICT DO NOTHING`,
      [userId, proc.rows[0].process_id],
    );
  }

  await client.end();

  console.log('\n=== Planning-Lite seed complete ===');
  console.log(`Login: ${EMAIL} / ${STAFF_PASSWORD}`);
  console.log(`Lines (WRITE): ${LINES.join(', ')}`);
  console.log('No machineAccess — import hub only (/planning/import).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
