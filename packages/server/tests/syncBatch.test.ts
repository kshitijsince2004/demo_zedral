import { describe, expect, it } from 'vitest';
import { dispatchSyncItem } from '../src/routes/syncBatchRoutes';

describe('sync batch (PERF-C3)', () => {
  it('rejects /sync urls in dispatch', async () => {
    const parent = { headers: {}, header: () => undefined, user: { id: 1 } } as never;
    const result = await dispatchSyncItem(null, parent, {
      id: '00000000-0000-4000-8000-000000000001',
      method: 'POST',
      url: '/sync/batch',
      payload: {},
    });
    expect(result.status).toBe(400);
  });

  it('rejects non-mutating methods', async () => {
    const parent = { headers: {}, header: () => undefined, user: { id: 1 } } as never;
    const result = await dispatchSyncItem(null, parent, {
      id: '00000000-0000-4000-8000-000000000002',
      method: 'GET',
      url: '/crew',
      payload: {},
    });
    expect(result.status).toBe(400);
  });
});
