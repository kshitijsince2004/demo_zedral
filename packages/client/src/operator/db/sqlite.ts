import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

let db: SQLiteDBConnection | null = null;

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

export async function initDb(): Promise<void> {
  if (!Capacitor.isNativePlatform() || db) return;
  if (!Capacitor.isPluginAvailable('CapacitorSQLite')) {
    console.warn('[SQLite] CapacitorSQLite plugin not registered on this build');
    return;
  }

  try {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    const check = await sqlite.checkConnectionsConsistency();
    const isConn = (await sqlite.isConnection('m1operator', false)).result;

    if (isConn && check.result) {
      db = await sqlite.retrieveConnection('m1operator', false);
    } else {
      db = await sqlite.createConnection('m1operator', false, 'no-encryption', 1, false);
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
