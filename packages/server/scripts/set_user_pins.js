/**
 * Set scrypt pin_hash for demo users (default PIN: 0000).
 * Run after migration 1781000000001_user_pin_hash.
 *
 *   node packages/server/scripts/set_user_pins.js
 */
const { Client } = require('pg');
const { scryptSync, randomBytes } = require('crypto');

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;
const DEFAULT_PIN = process.env.DEMO_USER_PIN || '0000';

function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LEN, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://m1_user:m1_password@localhost:5432/m1_db',
  });
  await client.connect();

  try {
    const pinHash = hashPin(DEFAULT_PIN);
    const result = await client.query(
      `UPDATE security.app_user
       SET pin_hash = $1, pin_failed_attempts = 0, pin_locked_until = NULL, status = 'ACTIVE'
       WHERE emp_code IS NOT NULL`,
      [pinHash]
    );
    console.log(`Updated pin_hash for ${result.rowCount} user(s) (PIN=${DEFAULT_PIN})`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
