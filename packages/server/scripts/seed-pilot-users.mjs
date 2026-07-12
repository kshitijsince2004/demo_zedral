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

const USERS = [
  { username: 'admin', emp_code: '1000', full_name: 'Plant Admin', role_id: 4, lines: [], machines: [] },
  { username: 'operator', emp_code: '3000', full_name: 'Shift Operator', role_id: 1, lines: ['HRS', '6HI'], machines: ['6HI'] },
  { username: 'machinehead', emp_code: '4000', full_name: 'Machine Head', role_id: 5, lines: ['6HI', '4HI', '2HI'], machines: ['6HI', '4HI', '2HI'] },
  { username: 'planthead', emp_code: '5000', full_name: 'Plant Head', role_id: 3, lines: ['HRS', 'PKL', 'CRM', '6HI'], machines: [] },
];

const PIN = process.env.SEED_PIN || '1234';

/** @param {pg.Client} client */
async function seedRoles(client) {
  await client.query(`
    INSERT INTO security.role (role_id, role_name, description) VALUES
      (1, 'OPERATOR', 'Line Operator: Can submit shift logs'),
      (3, 'PLANT_HEAD', 'Plant Head: View all reports'),
      (4, 'ADMIN', 'System Administrator: Manage master data'),
      (5, 'MACHINE_HEAD', 'Machine Head: Manages assigned machines')
    ON CONFLICT (role_id) DO NOTHING;
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
      `SELECT user_id FROM security.app_user WHERE emp_code = $1`,
      [u.emp_code],
    );

    let userId;
    if (existing.rows.length > 0) {
      userId = existing.rows[0].user_id;
      await client.query(
        `UPDATE security.app_user
         SET pin_hash = $1, status = 'ACTIVE', pin_failed_attempts = 0, pin_locked_until = NULL
         WHERE user_id = $2`,
        [pinHash, userId],
      );
      console.log(`Updated user ${u.emp_code} (${u.username})`);
    } else {
      let stUserId = null;
      if (u.role_id === 3 || u.role_id === 4 || u.role_id === 5) {
        const email = `${u.username}@zedral.local`;
        try {
          const response = await EmailPassword.signUp('', email, 'Password123!');
          if (response.status === 'OK') {
            stUserId = response.user.id;
          }
        } catch (err) {
          console.error(`Failed to create SuperTokens user for ${u.username}`, err);
        }
      }

      const inserted = await client.query(
        `INSERT INTO security.app_user (username, full_name, emp_code, status, pin_hash, supertokens_user_id)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5)
         RETURNING user_id`,
        [u.username, u.full_name, u.emp_code, pinHash, stUserId],
      );
      userId = inserted.rows[0].user_id;
      console.log(`Created user ${u.emp_code} (${u.username})`);
    }

    await client.query(
      `INSERT INTO security.user_role (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, u.role_id],
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
  return { pin: PIN, users: USERS, userIds };
}

const isMain = process.argv[1]?.includes('seed-pilot-users');
if (isMain) {
  seedPilotUsers()
    .then((result) => {
      console.log(`\nPilot users ready (PIN: ${result.pin}):`);
      for (const u of result.users) {
        console.log(`  Badge ${u.emp_code} — ${u.full_name} (role ${u.role_id})`);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
