import type { RequestHandler } from 'express';
import { sql } from 'kysely';
import { db } from '../db';
import { logger } from '../utils/logger';

const IDEMPOTENT_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface IdempotencyRow {
  status: string;
  response_status: number | null;
  response_body: unknown;
}

export type IdempotencyDecision =
  | { kind: 'execute' }
  | { kind: 'inflight' }
  | { kind: 'replay'; status: number; body: unknown };

export function decideIdempotencyReplay(row: IdempotencyRow | null): IdempotencyDecision {
  if (!row) return { kind: 'execute' };
  if (row.status === 'done' && row.response_status != null) {
    return { kind: 'replay', status: row.response_status, body: row.response_body ?? {} };
  }
  return { kind: 'inflight' };
}

async function insertPending(key: string): Promise<boolean> {
  const result = await sql<{ key: string }>`
    INSERT INTO txn.idempotency_key (key, status, response_status, response_body)
    VALUES (${key}::uuid, 'pending', NULL, NULL)
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  `.execute(db);
  return result.rows.length > 0;
}

async function loadRow(key: string): Promise<IdempotencyRow | null> {
  const result = await sql<IdempotencyRow>`
    SELECT status, response_status, response_body
    FROM txn.idempotency_key
    WHERE key = ${key}::uuid
  `.execute(db);
  return result.rows[0] ?? null;
}

async function finalizeDone(key: string, status: number, body: unknown): Promise<void> {
  await sql`
    UPDATE txn.idempotency_key
    SET status = 'done',
        response_status = ${status},
        response_body = ${JSON.stringify(body ?? {})}::jsonb
    WHERE key = ${key}::uuid
  `.execute(db);
}

async function releasePending(key: string): Promise<void> {
  await sql`
    DELETE FROM txn.idempotency_key
    WHERE key = ${key}::uuid AND status = 'pending'
  `.execute(db);
}

export async function pruneIdempotencyKeys(): Promise<number> {
  const result = await sql`
    DELETE FROM txn.idempotency_key
    WHERE status = 'done'
      AND created_at < now() - interval '14 days'
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}

export const idempotencyMiddleware: RequestHandler = async (req, res, next) => {
  if (!IDEMPOTENT_METHODS.has(req.method)) {
    next();
    return;
  }

  const key = req.header('X-Idempotency-Key');
  if (!key) {
    next();
    return;
  }

  if (!UUID_RE.test(key)) {
    res.status(400).json({ error: 'Invalid X-Idempotency-Key' });
    return;
  }

  try {
    const inserted = await insertPending(key);
    if (!inserted) {
      const existing = await loadRow(key);
      const decision = decideIdempotencyReplay(existing);
      if (decision.kind === 'replay') {
        logger.info(JSON.stringify({ msg: 'idempotency', outcome: 'hit', key, status: decision.status }));
        res.status(decision.status).json(decision.body);
        return;
      }
      logger.info(JSON.stringify({ msg: 'idempotency', outcome: 'pending', key }));
      res.status(409).json({ error: 'IDEMPOTENCY_IN_FLIGHT' });
      return;
    }
    logger.info(JSON.stringify({ msg: 'idempotency', outcome: 'miss', key }));
  } catch (error) {
    next(error);
    return;
  }

  let responseBody: unknown;
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as typeof res.json;

  res.on('finish', () => {
    const status = res.statusCode;
    if ((status >= 200 && status < 300) || status === 409) {
      void finalizeDone(key, status, responseBody ?? {}).catch(() => undefined);
      return;
    }
    void releasePending(key).catch(() => undefined);
  });

  next();
};
