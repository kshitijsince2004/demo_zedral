#!/usr/bin/env node
/**
 * Reset pilot badges 1000/2000/3000 to PIN 1234 with hashes compatible with pinService.
 * Usage: npm run reset:pins -w @m1/server
 */
import pg from 'pg';
import { scryptSync, randomBytes } from 'node:crypto';

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://m1_user:m1_password@localhost:5432/m1_db';

const BADGES = ['1000', '2000', '3000'];
const PIN = '1234';

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const pinHash = hashPin(PIN);
for (const badge of BADGES) {
  const r = await client.query(
    `UPDATE security.app_user
     SET pin_hash = $1, status = 'ACTIVE', pin_failed_attempts = 0, pin_locked_until = NULL
     WHERE emp_code = $2
     RETURNING username`,
    [pinHash, badge],
  );
  console.log(r.rows[0] ? `Updated ${badge} (${r.rows[0].username})` : `Missing ${badge}`);
}
await client.end();
console.log(`Pilot PINs reset to ${PIN}`);
