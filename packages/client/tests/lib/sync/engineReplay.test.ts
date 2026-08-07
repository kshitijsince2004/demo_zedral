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
  reconcileBenignParked: vi.fn(async () => 0),
  discardInaccessibleMachineActions: vi.fn(async () => 0),
  counts: vi.fn(async () => ({ pending: 0, parked: 0 })),
}));

vi.mock('../../../src/lib/authStore', () => ({
  useAuthStore: {
    getState: () => ({ role: 'OPERATOR', machineAccess: ['6HI'] }),
  },
}));

vi.mock('../../../src/lib/productionSync', () => ({
  notifyProductionChanged: vi.fn(),
}));

vi.mock('@capacitor/network', () => ({
  Network: { addListener: vi.fn() },
}));

vi.mock('supertokens-auth-react/recipe/session', () => ({
  default: {
    doesSessionExist: vi.fn(async () => true),
  },
}));

import { apiFetch } from '../../../src/lib/apiClient';
import * as outbox from '../../../src/lib/sync/outboxRepo';
import { syncNow } from '../../../src/lib/sync/engine';
import { notifyProductionChanged } from '../../../src/lib/productionSync';

describe('sync engine replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Tests assert sequential apiFetch replay; batch path is covered elsewhere.
    vi.stubEnv('VITE_SYNC_BATCH', 'false');
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

  it('soft-succeeds benign client errors instead of parking', async () => {
    vi.mocked(outbox.nextBatch).mockResolvedValueOnce([
      [
        {
          id: '3',
          aggregateKey: 'handover:6HI',
          seq: 1,
          url: '/machines/handover/6HI/session',
          method: 'POST',
          payload: '{}',
          status: 'pending',
          attempts: 0,
          createdAt: Date.now(),
        },
      ],
    ]);
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error:
            'ACTIVE_SESSION_CONFLICT: Another operator holds an active session on this machine.',
        }),
    } as Response);

    await syncNow('test');

    expect(outbox.markSynced).toHaveBeenCalledWith('3');
    expect(outbox.markParked).not.toHaveBeenCalled();
  });

  it('parks non-benign 4xx errors', async () => {
    vi.mocked(outbox.nextBatch).mockResolvedValueOnce([
      [
        {
          id: '4',
          aggregateKey: 'handover:6HI',
          seq: 1,
          url: '/machines/handover/6HI/outgoing',
          method: 'POST',
          payload: '{}',
          status: 'pending',
          attempts: 0,
          createdAt: Date.now(),
        },
      ],
    ]);
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'Machine status is required' }),
    } as Response);

    await syncNow('test');

    expect(outbox.markParked).toHaveBeenCalledWith(
      '4',
      expect.stringContaining('Machine status is required'),
    );
    expect(outbox.markSynced).not.toHaveBeenCalledWith('4');
  });

  it('keeps auth failures pending instead of parking', async () => {
    vi.mocked(outbox.nextBatch).mockResolvedValueOnce([
      [
        {
          id: '5',
          aggregateKey: 'handover:6HI',
          seq: 1,
          url: '/machines/handover/6HI/outgoing',
          method: 'POST',
          payload: '{}',
          status: 'pending',
          attempts: 0,
          createdAt: Date.now(),
        },
      ],
    ]);
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'Unauthorized' }),
    } as Response);

    await syncNow('test');

    expect(outbox.bumpAttempt).toHaveBeenCalledWith('5', expect.stringContaining('Unauthorized'));
    expect(outbox.markParked).not.toHaveBeenCalled();
  });
});
