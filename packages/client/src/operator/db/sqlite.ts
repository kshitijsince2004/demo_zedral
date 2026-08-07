import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

let db: SQLiteDBConnection | null = null;

const DB_NAME = 'm1operator';
const KEY_PREF = 'm1operator_sqlite_key';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  aggregate_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  synced_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_outbox_agg ON outbox (aggregate_key, seq);
CREATE TABLE IF NOT EXISTS master_cache (
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (table_name, row_id)
);
CREATE TABLE IF NOT EXISTS plan_cache (
  coil_no TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_cache (
  user_code TEXT PRIMARY KEY,
  pin_verifier TEXT NOT NULL,
  display_name TEXT,
  role TEXT,
  line_code TEXT,
  cached_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

async function getOrCreatePassphrase(): Promise<string> {
  const existing = await Preferences.get({ key: KEY_PREF });
  if (existing.value) return existing.value;
  const value = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  await Preferences.set({ key: KEY_PREF, value });
  return value;
}

/** Ensure plugin secure-store has the passphrase (SQLCipher). */
async function ensureEncryptionSecret(sqlite: SQLiteConnection): Promise<void> {
  const passphrase = await getOrCreatePassphrase();
  const stored = await sqlite.isSecretStored();
  if (!stored.result) {
    await sqlite.setEncryptionSecret(passphrase);
  }
}

async function encryptionMode(sqlite: SQLiteConnection): Promise<'secret' | 'encryption'> {
  const exists = await sqlite.isDatabase(DB_NAME);
  if (!exists.result) return 'secret';
  try {
    const enc = await sqlite.isDatabaseEncrypted(DB_NAME);
    // mode "encryption" = encrypt an existing unencrypted DB once
    return enc.result ? 'secret' : 'encryption';
  } catch {
    return 'encryption';
  }
}

export async function initDb(): Promise<void> {
  if (!Capacitor.isNativePlatform() || db) return;
  if (!Capacitor.isPluginAvailable('CapacitorSQLite')) {
    console.warn('[SQLite] CapacitorSQLite plugin not registered on this build');
    return;
  }

  try {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    await ensureEncryptionSecret(sqlite);

    const check = await sqlite.checkConnectionsConsistency();
    const isConn = (await sqlite.isConnection(DB_NAME, false)).result;

    if (isConn && check.result) {
      db = await sqlite.retrieveConnection(DB_NAME, false);
    } else {
      const mode = await encryptionMode(sqlite);
      db = await sqlite.createConnection(DB_NAME, true, mode, 1, false);
    }

    await db.open();
    await db.execute(SCHEMA);
  } catch (err) {
    db = null;
    throw err;
  }
}

export function getDb(): SQLiteDBConnection {
  if (!db) throw new Error('SQLite not initialised');
  return db;
}

export const hasNativeDb = () => db !== null;

/**
 * Wipe encrypted local DB (device retention).
 * // ponytail: call on logout / factory device wipe when retention is decided;
 * // do not auto-wipe while outbox may still hold unsynced captures.
 */
export async function wipeLocalDb(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!Capacitor.isPluginAvailable('CapacitorSQLite')) return;

  const sqlite = new SQLiteConnection(CapacitorSQLite);
  try {
    if (db) {
      try {
        await db.close();
      } catch {
        /* already closed */
      }
      try {
        await db.delete();
      } catch {
        /* missing */
      }
      db = null;
    }
    const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
    if (isConn) {
      await sqlite.closeConnection(DB_NAME, false);
    }
  } catch (err) {
    console.warn('[SQLite] wipeLocalDb failed', err);
    db = null;
  }
}
