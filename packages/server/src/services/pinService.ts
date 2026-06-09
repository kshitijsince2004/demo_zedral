import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

/** Hash a 4-digit PIN for storage in security.app_user.pin_hash. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LEN, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time comparison against a stored scrypt hash. */
export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length === 0) return false;

  const hash = scryptSync(pin, salt, KEY_LEN, SCRYPT_OPTIONS);
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
