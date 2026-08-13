import { get, set } from 'idb-keyval';
import { getDb, hasNativeDb } from '../../operator/db/sqlite';
import { machineCodeFromOutboxUrl } from './outboxPolicy';

export type OutboxMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type OutboxStatus = 'pending' | 'inflight' | 'synced' | 'parked';

export interface OutboxActionInput {
  id: string;
  aggregateKey: string;
  url: string;
  method: OutboxMethod;
  payload: unknown;
  idempotencyKey?: string;
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
  idempotencyKey?: string | null;
}

const WEB_OUTBOX_KEY = 'm1:outbox';
/** Native SQLite nextBatch page size — keep drain loop in sync with LIMIT below. */
export const OUTBOX_BATCH_LIMIT = 200;

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
  idempotency_key?: string | null;
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
    idempotencyKey: row.idempotency_key ?? null,
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

  // Include parked heads so Attention/syncNow can replay after a server-side fix
  // (e.g. surface_finish FK). Only pending was replayed before — parked stuck forever.
  return Array.from(groups.values())
    .map((group) => group.sort((a, b) => a.seq - b.seq))
    .filter((group) => {
      const head = group[0]?.status;
      return head === 'pending' || head === 'parked';
    })
    .map((group) => group.filter((row) => row.status === 'pending' || row.status === 'parked'));
}

function outboxDedupEnabled(): boolean {
  try {
    return import.meta.env.VITE_OUTBOX_DEDUP !== 'false';
  } catch {
    return true;
  }
}

const ACTIVE_DEDUP = new Set<OutboxStatus>(['pending', 'parked', 'inflight']);

function findActiveByKey(rows: OutboxAction[], key: string | undefined): OutboxAction | undefined {
  if (!key || !outboxDedupEnabled()) return undefined;
  return rows.find((row) => row.idempotencyKey === key && ACTIVE_DEDUP.has(row.status));
}

export async function enqueue(action: OutboxActionInput): Promise<OutboxAction> {
  const createdAt = Date.now();
  const payload = JSON.stringify(action.payload);

  if (!hasNativeDb()) {
    return withWebRows((rows) => {
      const existing = findActiveByKey(rows, action.idempotencyKey);
      if (existing) {
        console.info('[outbox] enqueue', {
          aggregateKey: action.aggregateKey,
          url: action.url,
          method: action.method,
          id: existing.id,
          idempotencyKey: action.idempotencyKey,
          deduped: true,
        });
        return existing;
      }
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
        idempotencyKey: action.idempotencyKey ?? null,
      };
      rows.push(row);
      console.info('[outbox] enqueue', {
        aggregateKey: action.aggregateKey,
        url: action.url,
        method: action.method,
        id: row.id,
        idempotencyKey: row.idempotencyKey,
        deduped: false,
      });
      return row;
    });
  }

  const db = getDb();
  if (action.idempotencyKey && outboxDedupEnabled()) {
    const dup = await db.query(
      `SELECT id, aggregate_key, seq, url, method, payload, status, attempts, last_error, created_at, synced_at, idempotency_key
       FROM outbox
       WHERE idempotency_key = ? AND status IN ('pending','parked','inflight')
       LIMIT 1`,
      [action.idempotencyKey],
    );
    const found = ((dup.values ?? []) as DbRow[])[0];
    if (found) {
      const existing = fromDbRow(found);
      console.info('[outbox] enqueue', {
        aggregateKey: action.aggregateKey,
        url: action.url,
        method: action.method,
        id: existing.id,
        idempotencyKey: action.idempotencyKey,
        deduped: true,
      });
      return existing;
    }
  }

  const seqResult = await db.query(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM outbox WHERE aggregate_key = ?',
    [action.aggregateKey],
  );
  const seq = Number(seqResult.values?.[0]?.next_seq ?? 1);

  try {
    await db.run(
      `INSERT INTO outbox (id, aggregate_key, seq, url, method, payload, status, attempts, created_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      [action.id, action.aggregateKey, seq, action.url, action.method, payload, createdAt, action.idempotencyKey ?? null],
    );
  } catch (err) {
    if (action.idempotencyKey && outboxDedupEnabled()) {
      const dup = await db.query(
        `SELECT id, aggregate_key, seq, url, method, payload, status, attempts, last_error, created_at, synced_at, idempotency_key
         FROM outbox
         WHERE idempotency_key = ? AND status IN ('pending','parked','inflight')
         LIMIT 1`,
        [action.idempotencyKey],
      );
      const found = ((dup.values ?? []) as DbRow[])[0];
      if (found) return fromDbRow(found);
    }
    throw err;
  }

  console.info('[outbox] enqueue', {
    aggregateKey: action.aggregateKey,
    url: action.url,
    method: action.method,
    id: action.id,
    idempotencyKey: action.idempotencyKey,
    deduped: false,
  });

  return {
    ...action,
    seq,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt,
    syncedAt: null,
    idempotencyKey: action.idempotencyKey ?? null,
  };
}

export async function nextBatch(): Promise<OutboxAction[][]> {
  if (!hasNativeDb()) {
    const rows = await webRows();
    return groupReplayable(rows.filter((row) => row.status === 'pending' || row.status === 'parked'));
  }

  const result = await getDb().query(
    `SELECT id, aggregate_key, seq, url, method, payload, status, attempts, last_error, created_at, synced_at, idempotency_key
     FROM outbox
     WHERE status IN ('pending', 'parked')
     ORDER BY aggregate_key ASC, seq ASC
     LIMIT ${OUTBOX_BATCH_LIMIT}`,
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

export async function pendingByAggregate(): Promise<Record<string, number>> {
  if (!hasNativeDb()) {
    const rows = await webRows();
    const map: Record<string, number> = {};
    for (const row of rows) {
      if (row.status !== 'pending' && row.status !== 'parked' && row.status !== 'inflight') continue;
      map[row.aggregateKey] = (map[row.aggregateKey] ?? 0) + 1;
    }
    return map;
  }

  const result = await getDb().query(
    `SELECT aggregate_key, COUNT(*) AS count FROM outbox
     WHERE status IN ('pending', 'parked', 'inflight')
     GROUP BY aggregate_key`,
  );
  const rows = (result.values ?? []) as { aggregate_key: string; count: number }[];
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.aggregate_key] = Number(row.count ?? 0);
  }
  return map;
}

export async function parkedActions(): Promise<OutboxAction[]> {
  if (!hasNativeDb()) {
    return (await webRows()).filter((row) => row.status === 'parked');
  }

  const result = await getDb().query(
    `SELECT id, aggregate_key, seq, url, method, payload, status, attempts, last_error, created_at, synced_at, idempotency_key
     FROM outbox WHERE status = 'parked' ORDER BY created_at ASC LIMIT 500`,
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

/** Mark parked rows synced when their lastError is a known benign client failure. */
export async function reconcileBenignParked(
  isBenign: (status: number, body: string) => boolean,
): Promise<number> {
  let cleared = 0;
  const syncedAt = Date.now();

  if (!hasNativeDb()) {
    await withWebRows((rows) => {
      for (const row of rows) {
        if (row.status !== 'parked') continue;
        const err = row.lastError ?? '';
        // Parked rows store response body only; treat as 400-class unless Forbidden → 403.
        const status = /Forbidden/i.test(err) ? 403 : 400;
        if (!isBenign(status, err)) continue;
        row.status = 'synced';
        row.syncedAt = syncedAt;
        cleared += 1;
      }
    });
    return cleared;
  }

  const result = await getDb().query(
    "SELECT id, last_error FROM outbox WHERE status = 'parked'",
  );
  const parked = (result.values ?? []) as { id: string; last_error?: string | null }[];
  for (const row of parked) {
    const err = row.last_error ?? '';
    const status = /Forbidden/i.test(err) ? 403 : 400;
    if (!isBenign(status, err)) continue;
    await getDb().run(
      "UPDATE outbox SET status = 'synced', synced_at = ? WHERE id = ? AND status = 'parked'",
      [syncedAt, row.id],
    );
    cleared += 1;
  }
  return cleared;
}

function shouldDropInaccessibleOutboxRow(
  url: string,
  lastError: string | null | undefined,
  allow: Set<string> | null,
): string | null {
  const err = lastError ?? '';
  if (/Forbidden:\s*No access to machine|No access to machine\s+\w+/i.test(err)) {
    return 'Dropped: Forbidden machine access';
  }
  if (/Forbidden:\s*No write access to line/i.test(err)) {
    return 'Dropped: Forbidden line write access';
  }
  const code = machineCodeFromOutboxUrl(url);
  if (!code) return null;
  // null allow = Admin/PH plant-wide write — keep rows unless Forbidden above
  if (allow === null) return null;
  if (allow.has(code)) return null;
  return `Dropped: no access to machine ${code}`;
}

/**
 * Drop pending/parked handover writes the current user cannot WRITE
 * (matches server assertMachineAccess). Also clears Forbidden parked rows.
 * `allowedMachines: null` = plant-wide write (Admin/PH).
 */
export async function discardInaccessibleMachineActions(
  allowedMachines: string[] | null,
): Promise<number> {
  const allow =
    allowedMachines === null
      ? null
      : new Set(allowedMachines.map((m) => m.toUpperCase()).filter(Boolean));

  let cleared = 0;
  const syncedAt = Date.now();

  if (!hasNativeDb()) {
    await withWebRows((rows) => {
      for (const row of rows) {
        if (row.status !== 'pending' && row.status !== 'parked') continue;
        const reason = shouldDropInaccessibleOutboxRow(row.url, row.lastError, allow);
        if (!reason) continue;
        row.status = 'synced';
        row.syncedAt = syncedAt;
        row.lastError = reason;
        cleared += 1;
      }
    });
    return cleared;
  }

  const result = await getDb().query(
    "SELECT id, url, last_error FROM outbox WHERE status IN ('pending', 'parked')",
  );
  const rows = (result.values ?? []) as {
    id: string;
    url: string;
    last_error?: string | null;
  }[];
  for (const row of rows) {
    const reason = shouldDropInaccessibleOutboxRow(row.url, row.last_error, allow);
    if (!reason) continue;
    await getDb().run(
      "UPDATE outbox SET status = 'synced', synced_at = ?, last_error = ? WHERE id = ?",
      [syncedAt, reason, row.id],
    );
    cleared += 1;
  }
  return cleared;
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
