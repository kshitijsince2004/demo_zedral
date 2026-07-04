import type { RequestHandler } from 'express';
import { sql } from 'kysely';
import { db } from '../db';

const IDEMPOTENT_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StoredResponse {
  response_status: number;
  response_body: unknown;
}

async function readStoredResponse(key: string): Promise<StoredResponse | null> {
  const result = await sql<StoredResponse>`
    SELECT response_status, response_body
    FROM txn.idempotency_key
    WHERE key = ${key}::uuid
  `.execute(db);

  return result.rows[0] ?? null;
}

async function storeResponse(key: string, status: number, body: unknown): Promise<void> {
  await sql`
    INSERT INTO txn.idempotency_key (key, response_status, response_body)
    VALUES (${key}::uuid, ${status}, ${JSON.stringify(body)}::jsonb)
    ON CONFLICT (key) DO NOTHING
  `.execute(db);
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
    const existing = await readStoredResponse(key);
    if (existing) {
      res.status(existing.response_status).json(existing.response_body ?? {});
      return;
    }
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
    if (res.statusCode >= 200 && res.statusCode < 300 && responseBody !== undefined) {
      void storeResponse(key, res.statusCode, responseBody).catch(() => undefined);
    }
  });

  next();
};
