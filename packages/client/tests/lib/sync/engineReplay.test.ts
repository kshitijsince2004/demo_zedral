import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../src/lib/sync/outboxRepo', () => ({
  nextBatch: vi.fn(),
  markSynced: vi.fn(),
  markParked: vi.fn(),
  bumpAttempt: vi.fn(),
  pruneSynced: vi.fn(),
  counts: vi.fn(async () => ({ pending: 0, parked: 0 })),
}));

vi.mock('../../../src/lib/productionSync', () => ({
  notifyProductionChanged: vi.fn(),
}));

vi.mock('@capacitor/network', () => ({
  Network: { addListener: vi.fn() },
}));

import { apiFetch } from '../../../src/lib/apiClient';
import * as outbox from '../../../src/lib/sync/outboxRepo';
import { syncNow } from '../../../src/lib/sync/engine';
import { notifyProductionChanged } from '../../../src/lib/productionSync';

describe('sync engine replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replays queued writes and invalidates caches on success', async () => {
    vi.mocked(outbox.nextBatch).mockResolvedValueOnce([
      [
        {
          id: '1',
          aggregateKey: '6hi-order:B1',
          seq: 1,
          url: '/6hi/orders/B1/start',
          method: 'POST',
          payload: '{}',
          status: 'pending',
          attempts: 0,
          createdAt: Date.now(),
        },
      ],
    ]);
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    await syncNow('test');

    expect(apiFetch).toHaveBeenCalledWith(
      '/6hi/orders/B1/start',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Idempotency-Key': '1' }),
      }),
    );
    expect(outbox.markSynced).toHaveBeenCalledWith('1');
    expect(notifyProductionChanged).toHaveBeenCalled();
  });

  it('omits body for DELETE replay', async () => {
    vi.mocked(outbox.nextBatch).mockResolvedValueOnce([
      [
        {
          id: '2',
          aggregateKey: '6hi-order:B2',
          seq: 1,
          url: '/6hi/orders/B2',
          method: 'DELETE',
          payload: '{}',
          status: 'pending',
          attempts: 0,
          createdAt: Date.now(),
        },
      ],
    ]);
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    await syncNow('test');

    expect(apiFetch).toHaveBeenCalledWith(
      '/6hi/orders/B2',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      '/6hi/orders/B2',
      expect.not.objectContaining({ body: '{}' }),
    );
  });
});