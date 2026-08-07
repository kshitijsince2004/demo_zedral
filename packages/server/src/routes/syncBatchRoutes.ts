import { Router, type Application, type Request } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';

const ALLOWED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const MAX_ITEMS = 100;

export type SyncBatchItem = {
  id: string;
  method: string;
  url: string;
  payload?: unknown;
  aggregateKey?: string;
};

export type SyncBatchResult = {
  id: string;
  status: number;
  body?: unknown;
  skipped?: boolean;
};

function parseBody(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function shouldStopAggregate(status: number): boolean {
  if (status === 409) return false;
  if (status >= 200 && status < 300) return false;
  return true;
}

function isTransientStatus(status: number): boolean {
  return status === 401 || status === 0 || status >= 500;
}

function loopbackBase(): string {
  const port = Number(process.env.PORT || 3005);
  const host = process.env.HOST || '127.0.0.1';
  return `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
}

function pickHeader(req: Request, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()] ?? req.header(name);
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Replay one outbox action via loopback HTTP through the live server stack
 * (auth + idempotency + handlers). Avoids fragile app.handle mock req/res
 * that can crash the process under SuperTokens.
 */
export async function dispatchSyncItem(
  _app: Application | null,
  parentReq: Request,
  item: SyncBatchItem,
): Promise<SyncBatchResult> {
  const method = String(item.method || '').toUpperCase();
  const pathAndQuery = normalizeUrl(item.url);
  const pathname = pathAndQuery.split('?')[0] ?? pathAndQuery;

  if (!ALLOWED_METHODS.has(method) || pathname.startsWith('/sync')) {
    return { id: item.id, status: 400, body: { error: 'Invalid batch item' } };
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-idempotency-key': item.id,
    'st-auth-mode': 'header',
  };
  const authorization = pickHeader(parentReq, 'authorization');
  const cookie = pickHeader(parentReq, 'cookie');
  if (authorization) headers.authorization = authorization;
  if (cookie) headers.cookie = cookie;

  const body =
    method === 'DELETE' ? undefined : JSON.stringify(parseBody(item.payload) ?? {});

  try {
    const res = await fetch(`${loopbackBase()}${pathAndQuery}`, {
      method,
      headers,
      body,
    });
    const text = await res.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    } else {
      parsed = undefined;
    }
    return { id: item.id, status: res.status, body: parsed };
  } catch (error) {
    return {
      id: item.id,
      status: 503,
      body: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

export function createSyncBatchRouter(app: Application): Router {
  const router = Router();
  router.use(rateLimitMiddleware(30, 60_000));

  router.post('/batch', requireAuth, async (req, res) => {
    if (process.env.SYNC_BATCH_ENABLED === 'false') {
      res.status(404).json({ error: 'Sync batch disabled' });
      return;
    }

    const raw = req.body?.items;
    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ error: 'items array required' });
      return;
    }
    if (raw.length > MAX_ITEMS) {
      res.status(400).json({ error: `At most ${MAX_ITEMS} items per batch` });
      return;
    }

    const items: SyncBatchItem[] = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const id = typeof row.id === 'string' ? row.id : '';
      const method = typeof row.method === 'string' ? row.method : '';
      const url = typeof row.url === 'string' ? row.url : '';
      if (!id || !method || !url) {
        res.status(400).json({ error: 'Each item needs id, method, url' });
        return;
      }
      items.push({
        id,
        method,
        url,
        payload: row.payload,
        aggregateKey: typeof row.aggregateKey === 'string' ? row.aggregateKey : id,
      });
    }

    const results: SyncBatchResult[] = [];
    const skippedAggregates = new Set<string>();
    let stopAll = false;

    for (const item of items) {
      const agg = item.aggregateKey ?? item.id;
      if (stopAll || skippedAggregates.has(agg)) {
        results.push({
          id: item.id,
          status: 0,
          skipped: true,
          body: { skipped: true, reason: stopAll ? 'prior_transient' : 'prior_aggregate_failure' },
        });
        continue;
      }

      const result = await dispatchSyncItem(app, req, item);
      results.push(result);

      if (!shouldStopAggregate(result.status)) continue;
      skippedAggregates.add(agg);
      if (isTransientStatus(result.status)) stopAll = true;
    }

    res.json({ results });
  });

  return router;
}
