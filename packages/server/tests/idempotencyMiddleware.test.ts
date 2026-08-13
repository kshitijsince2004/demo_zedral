import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

type StoreRow = {
  status: string;
  response_status: number | null;
  response_body: unknown;
};

const { store } = vi.hoisted(() => ({
  store: new Map<string, StoreRow>(),
}));

vi.mock('../src/db', () => ({ db: {} }));

vi.mock('kysely', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    execute: async () => {
      const q = strings.join(' ');
      if (q.includes('INSERT INTO txn.idempotency_key')) {
        const key = String(values[0]);
        if (store.has(key)) return { rows: [] };
        store.set(key, { status: 'pending', response_status: null, response_body: null });
        return { rows: [{ key }] };
      }
      if (q.includes('SELECT status, response_status')) {
        const row = store.get(String(values[0]));
        return { rows: row ? [row] : [] };
      }
      if (q.includes("SET status = 'done'")) {
        const status = values[0] as number;
        const bodyRaw = values[1];
        const key = String(values[2]);
        let body: unknown = bodyRaw;
        if (typeof bodyRaw === 'string') {
          try {
            body = JSON.parse(bodyRaw);
          } catch {
            body = bodyRaw;
          }
        }
        store.set(key, { status: 'done', response_status: status, response_body: body });
        return { rows: [], numAffectedRows: 1n };
      }
      if (q.includes("AND status = 'pending'")) {
        const key = String(values[0]);
        if (store.get(key)?.status === 'pending') store.delete(key);
        return { rows: [], numAffectedRows: 1n };
      }
      if (q.includes("status = 'done'") && q.includes('created_at')) {
        let n = 0;
        for (const [key, row] of [...store.entries()]) {
          if (row.status === 'done') {
            store.delete(key);
            n += 1;
          }
        }
        return { rows: [], numAffectedRows: BigInt(n) };
      }
      return { rows: [], numAffectedRows: 0n };
    },
  }),
}));

import {
  decideIdempotencyReplay,
  idempotencyMiddleware,
  pruneIdempotencyKeys,
} from '../src/middleware/idempotencyMiddleware';

const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

class MockRes extends EventEmitter {
  statusCode = 200;
  body: unknown;
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(body: unknown) {
    this.body = body;
    return this;
  }
}

function mockReq(method: string, key?: string): Request {
  return {
    method,
    header: (name: string) =>
      name.toLowerCase() === 'x-idempotency-key' ? key : undefined,
  } as Request;
}

describe('decideIdempotencyReplay', () => {
  it('executes when no row exists', () => {
    expect(decideIdempotencyReplay(null)).toEqual({ kind: 'execute' });
  });

  it('replays a stored done response', () => {
    expect(
      decideIdempotencyReplay({
        status: 'done',
        response_status: 200,
        response_body: { ok: true },
      }),
    ).toEqual({ kind: 'replay', status: 200, body: { ok: true } });
  });

  it('treats pending as in-flight', () => {
    expect(
      decideIdempotencyReplay({
        status: 'pending',
        response_status: null,
        response_body: null,
      }),
    ).toEqual({ kind: 'inflight' });
  });
});

describe('idempotencyMiddleware', () => {
  beforeEach(() => {
    store.clear();
  });

  it('passes GET through without a key', async () => {
    const next = vi.fn() as NextFunction;
    const res = new MockRes() as unknown as Response;
    await idempotencyMiddleware(mockReq('GET'), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(store.size).toBe(0);
  });

  it('passes mutating requests with no key', async () => {
    const next = vi.fn() as NextFunction;
    const res = new MockRes() as unknown as Response;
    await idempotencyMiddleware(mockReq('POST'), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(store.size).toBe(0);
  });

  it('rejects an invalid key with 400', async () => {
    const next = vi.fn() as NextFunction;
    const res = new MockRes();
    await idempotencyMiddleware(mockReq('POST', 'not-a-uuid'), res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid X-Idempotency-Key' });
  });

  it('executes the first call and stores a 2xx as done', async () => {
    const next = vi.fn() as NextFunction;
    const res = new MockRes();
    await idempotencyMiddleware(mockReq('POST', KEY), res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(store.get(KEY)?.status).toBe('pending');

    res.status(201).json({ created: true });
    res.emit('finish');
    await vi.waitFor(() => expect(store.get(KEY)?.status).toBe('done'));
    expect(store.get(KEY)).toMatchObject({
      status: 'done',
      response_status: 201,
      response_body: { created: true },
    });
  });

  it('replays a stored done response on the second call', async () => {
    store.set(KEY, {
      status: 'done',
      response_status: 200,
      response_body: { replayed: true },
    });
    const next = vi.fn() as NextFunction;
    const res = new MockRes();
    await idempotencyMiddleware(mockReq('POST', KEY), res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ replayed: true });
  });

  it('returns 409 IDEMPOTENCY_IN_FLIGHT while pending', async () => {
    store.set(KEY, { status: 'pending', response_status: null, response_body: null });
    const next = vi.fn() as NextFunction;
    const res = new MockRes();
    await idempotencyMiddleware(mockReq('PATCH', KEY), res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'IDEMPOTENCY_IN_FLIGHT' });
  });

  it('releases a pending row on 5xx so a retry can execute', async () => {
    const next = vi.fn() as NextFunction;
    const res = new MockRes();
    await idempotencyMiddleware(mockReq('POST', KEY), res as unknown as Response, next);
    res.statusCode = 500;
    res.json({ error: 'boom' });
    res.emit('finish');
    await vi.waitFor(() => expect(store.has(KEY)).toBe(false));
  });
});

describe('pruneIdempotencyKeys', () => {
  beforeEach(() => {
    store.clear();
  });

  it('deletes done rows', async () => {
    store.set(KEY, { status: 'done', response_status: 200, response_body: {} });
    const n = await pruneIdempotencyKeys();
    expect(n).toBe(1);
    expect(store.size).toBe(0);
  });
});
