import { get, set } from 'idb-keyval';
import { getDb, hasNativeDb } from '../../operator/db/sqlite';

export type OutboxMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type OutboxStatus = 'pending' | 'inflight' | 'synced' | 'parked';

export interface OutboxActionInput {
  id: string;
  aggregateKey: string;
  url: string;
  method: OutboxMethod;
  payload: unknown;
}

export interface OutboxAction {
  id: string;
  aggregateKey: string;
  seq: number;
  url: string;
  method: OutboxMethod;
  payload: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string | null;
  createdAt: number;
  syncedAt?: number | null;
}

const WEB_OUTBOX_KEY = 'm1:outbox';

type DbRow = {
  id: string;
  aggregate_key: string;
  seq: number;
  url: string;
  method: OutboxMethod;
  payload: string;
  status: OutboxStatus;
  attempts: number;
  last_error?: string | null;
  created_at: number;
  synced_at?: number | null;
};

function fromDbRow(row: DbRow): OutboxAction {
  return {
    id: row.id,
    aggregateKey: row.aggregate_key,
    seq: Number(row.seq),
    url: row.url,
    method: row.method,
    payload: row.payload,
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error,
    createdAt: Number(row.created_at),
    syncedAt: row.synced_at ?? null,
  };
}

async function webRows(): Promise<OutboxAction[]> {
  return (await get<OutboxAction[]>(WEB_OUTBOX_KEY)) ?? [];
}

async function setWebRows(rows: OutboxAction[]): Promise<void> {
  await set(WEB_OUTBOX_KEY, rows);
}

async function withWebRows<T>(mutator: (rows: OutboxAction[]) => T | Promise<T>): Promise<T> {
  const rows = await webRows();
  const result = await mutator(rows);
  await setWebRows(rows);
  return result;
}

function groupReplayable(rows: OutboxAction[]): OutboxAction[][] {
  const groups = new Map<string, OutboxAction[]>();
  for (const row of rows) {
    const group = groups.get(row.aggregateKey) ?? [];
    group.push(row);
    groups.set(row.aggregateKey, group);
  }

  return Array.from(groups.values())
    .map((group) => group.sort((a, b) => a.seq - b.seq))
    .filter((group) => group[0]?.status === 'pending')
    .map((group) => group.filter((row) => row.status === 'pending'));
}

export async function enqueue(action: OutboxActionInput): Promise<OutboxAction> {
  const createdAt = Date.now();
  const payload = JSON.stringify(action.payload);

  if (!hasNativeDb()) {
    return withWebRows((rows) => {
      const seq = rows
        .filter((row) => row.aggregateKey === action.aggregateKey)
        .reduce((max, row) => Math.max(max, row.seq), 0) + 1;
      const row: OutboxAction = {
        ...action,
        seq,
        payload,
        status: 'pending',
        attempts: 0,
        createdAt,
        syncedAt: null,
      };
      rows.push(row);
      return row;
    });
  }

  const db = getDb();
  const seqResult = await db.query(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM outbox WHERE aggregate_key = ?',
    [action.aggregateKey],
  );
  const seq = Number(seqResult.values?.[0]?.next_seq ?? 1);

  await db.run(
    `INSERT INTO outbox (id, aggregate_key, seq, url, method, payload, status, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [action.id, action.aggregateKey, seq, action.url, action.method, payload, createdAt],
  );

  return {
    ...action,
    seq,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt,
    syncedAt: null,
  };
}

export async function nextBatch(): Promise<OutboxAction[][]> {
  if (!hasNativeDb()) {
    const rows = await webRows();
    return groupReplayable(rows.filter((row) => row.status === 'pending' || row.status === 'parked'));
  }

  const result = await getDb().query(
    `SELECT * FROM outbox
     WHERE status IN ('pending', 'parked')
     ORDER BY aggregate_key ASC, seq ASC`,
  );
  return groupReplayable(((result.values ?? []) as DbRow[]).map(fromDbRow));
}

export async function markSynced(id: string): Promise<void> {
  const syncedAt = Date.now();
  if (!hasNativeDb()) {
    await withWebRows((rows) => {
      const row = rows.find((item) => item.id === id);
      if (row) {
        row.status = 'synced';
        row.syncedAt = syncedAt;
      }
    });
    return;
  }

  await getDb().run("UPDATE outbox SET status = 'synced', synced_at = ? WHERE id = ?", [syncedAt, id]);
}

export async function markParked(id: string, error: string): Promise<void> {
  if (!hasNativeDb()) {
    await withWebRows((rows) => {
      const row = rows.find((item) => item.id === id);
      if (row) {
        row.status = 'parked';
        row.lastError = error;
      }
    });
    return;
  }

  await getDb().run("UPDATE outbox SET status = 'parked', last_error = ? WHERE id = ?", [error, id]);
}

export async function bumpAttempt(id: string, error: string): Promise<void> {
  if (!hasNativeDb()) {
    await withWebRows((rows) => {
      const row = rows.find((item) => item.id === id);
      if (row) {
        row.attempts += 1;
        row.lastError = error;
      }
    });
    return;
  }

  await getDb().run(
    "UPDATE outbox SET attempts = attempts + 1, last_error = ?, status = 'pending' WHERE id = ?",
    [error, id],
  );
}

export async function counts(): Promise<{ pending: number; parked: number }> {
  if (!hasNativeDb()) {
    const rows = await webRows();
    return {
      pending: rows.filter((row) => row.status === 'pending').length,
      parked: rows.filter((row) => row.status === 'parked').length,
    };
  }

  const result = await getDb().query(
    `SELECT status, COUNT(*) AS count FROM outbox
     WHERE status IN ('pending', 'parked')
     GROUP BY status`,
  );
  const rows = (result.values ?? []) as { status: OutboxStatus; count: number }[];
  return {
    pending: Number(rows.find((row) => row.status === 'pending')?.count ?? 0),
    parked: Number(rows.find((row) => row.status === 'parked')?.count ?? 0),
  };
}

export async function parkedActions(): Promise<OutboxAction[]> {
  if (!hasNativeDb()) {
    return (await webRows()).filter((row) => row.status === 'parked');
  }

  const result = await getDb().query(
    "SELECT * FROM outbox WHERE status = 'parked' ORDER BY created_at ASC",
  );
  return ((result.values ?? []) as DbRow[]).map(fromDbRow);
}

export async function discardParked(id: string): Promise<void> {
  if (!hasNativeDb()) {
    await withWebRows((rows) => {
      const row = rows.find((item) => item.id === id);
      if (row) row.status = 'synced';
    });
    return;
  }

  await getDb().run(
    "UPDATE outbox SET status = 'synced', synced_at = ? WHERE id = ? AND status = 'parked'",
    [Date.now(), id],
  );
}

export async function pruneSynced(olderThanDays = 30): Promise<void> {
  const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  if (!hasNativeDb()) {
    await withWebRows((rows) => {
      const keep = rows.filter((row) => row.status !== 'synced' || (row.syncedAt ?? Date.now()) >= threshold);
      rows.splice(0, rows.length, ...keep);
    });
    return;
  }

  await getDb().run("DELETE FROM outbox WHERE status = 'synced' AND synced_at < ?", [threshold]);
}
