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
});