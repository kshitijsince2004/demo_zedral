import { describe, expect, it, vi, beforeEach } from 'vitest';

const idbStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    idbStore.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    idbStore.delete(key);
  }),
}));

vi.mock('../../../src/operator/db/sqlite', () => ({
  hasNativeDb: () => false,
  getDb: () => {
    throw new Error('native db unavailable in tests');
  },
}));

import * as outbox from '../../../src/lib/sync/outboxRepo';

describe('outbox ordering', () => {
  beforeEach(() => {
    idbStore.clear();
    vi.clearAllMocks();
  });

  it('assigns increasing seq per aggregate key', async () => {
    await outbox.enqueue({
      id: 'a1',
      aggregateKey: 'order:batch-1',
      url: '/6hi/orders/batch-1/start',
      method: 'POST',
      payload: {},
    });
    await outbox.enqueue({
      id: 'a2',
      aggregateKey: 'order:batch-1',
      url: '/6hi/orders/batch-1/end',
      method: 'POST',
      payload: { defectCodes: [] },
    });

    const batches = await outbox.nextBatch();
    expect(batches).toHaveLength(1);
    expect(batches[0].map((row) => row.seq)).toEqual([1, 2]);
  });

  it('keeps separate groups per aggregate key', async () => {
    await outbox.enqueue({
      id: 'b1',
      aggregateKey: 'order:a',
      url: '/a',
      method: 'POST',
      payload: {},
    });
    await outbox.enqueue({
      id: 'b2',
      aggregateKey: 'order:b',
      url: '/b',
      method: 'POST',
      payload: {},
    });

    const batches = await outbox.nextBatch();
    expect(batches).toHaveLength(2);
    expect(batches.every((group) => group.length === 1)).toBe(true);
  });

  it('dedups N identical enqueues with the same idempotency key', async () => {
    const input = {
      aggregateKey: 'order:dup',
      url: '/6hi/orders/dup/start',
      method: 'POST' as const,
      payload: {},
      idempotencyKey: '11111111-1111-5111-8111-111111111111',
    };
    const first = await outbox.enqueue({ id: 'd1', ...input });
    const second = await outbox.enqueue({ id: 'd2', ...input });
    const third = await outbox.enqueue({ id: 'd3', ...input });

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    const batches = await outbox.nextBatch();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });

  it('keeps separate rows when the payload key differs', async () => {
    await outbox.enqueue({
      id: 'p1',
      aggregateKey: 'order:payload',
      url: '/6hi/orders/p/end',
      method: 'POST',
      payload: { n: 1 },
      idempotencyKey: '22222222-2222-5222-8222-222222222221',
    });
    await outbox.enqueue({
      id: 'p2',
      aggregateKey: 'order:payload',
      url: '/6hi/orders/p/end',
      method: 'POST',
      payload: { n: 2 },
      idempotencyKey: '22222222-2222-5222-8222-222222222222',
    });

    const batches = await outbox.nextBatch();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('does not let a synced row block a later repeat of the same key', async () => {
    const key = '33333333-3333-5333-8333-333333333333';
    const first = await outbox.enqueue({
      id: 's1',
      aggregateKey: 'order:repeat',
      url: '/6hi/orders/r/start',
      method: 'POST',
      payload: {},
      idempotencyKey: key,
    });
    await outbox.markSynced(first.id);

    const second = await outbox.enqueue({
      id: 's2',
      aggregateKey: 'order:repeat',
      url: '/6hi/orders/r/start',
      method: 'POST',
      payload: {},
      idempotencyKey: key,
    });

    expect(second.id).toBe('s2');
    expect(second.status).toBe('pending');
    const batches = await outbox.nextBatch();
    expect(batches[0].map((row) => row.id)).toEqual(['s2']);
  });
});