import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
  },
}));

vi.mock('../src/services/sixHi', () => ({
  SixHiShiftService: {
    resolveShiftLogIdForPlan: vi.fn(async () => 'shift-1'),
    resolveShiftLogIdsForPlan: vi.fn(async () => ['shift-1']),
    getShiftSummary: vi.fn(async () => ({
      totalProdMt: 32,
      completedProdMt: 32,
      inProgressProdMt: 0,
      targetCompletedMt: 30,
      completedOrders: [{}, {}],
      ordersInProgress: [],
    })),
  },
}));

import { LiveService, resolveMachineLiveStatus, resolveStateSinceAt } from '../src/services/LiveService';
import { db } from '../src/db';
import { SixHiShiftService } from '../src/services/sixHi';

describe('LiveService.getShiftCompletedProductionMt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unified shift summary totals for machine scope', async () => {
    const result = await LiveService.getShiftCompletedProductionMt(['6HI'], '2026-06-10', 'A');

    expect(SixHiShiftService.resolveShiftLogIdsForPlan).toHaveBeenCalledWith('2026-06-10', 'A');
    expect(SixHiShiftService.getShiftSummary).toHaveBeenCalledWith(['shift-1'], ['6HI']);
    expect(result.completedOrderCount).toBe(2);
    expect(result.inProgressOrderCount).toBe(0);
    expect(result.orderCount).toBe(2);
    expect(result.actualMt).toBe(32);
    expect(result.totalProdMt).toBe(32);
    // Target MT is now the summed PPC/planned weight of completed orders (Task 3),
    // surfaced through the summary — not txn.shift_log.target_mt.
    expect(result.targetCompletedMt).toBe(30);
  });

  it('returns zero when machine scope is empty', async () => {
    const result = await LiveService.getShiftCompletedProductionMt([], '2026-06-10', 'A');
    expect(result).toEqual({
      actualMt: 0,
      completedOrderCount: 0,
      inProgressOrderCount: 0,
      orderCount: 0,
      completedProdMt: 0,
      inProgressMt: 0,
      totalProdMt: 0,
      targetCompletedMt: 0,
    });
    expect(db.selectFrom).not.toHaveBeenCalled();
  });
});

describe('LiveService machine status resolution', () => {
  it('treats queued PENDING orders as idle', () => {
    expect(
      resolveMachineLiveStatus(undefined, undefined, { status: 'PENDING', stoppage_category: null }),
    ).toBe('IDLE');
  });

  it('uses IN_PROGRESS order as running when no event exists', () => {
    expect(
      resolveMachineLiveStatus(undefined, undefined, { status: 'IN_PROGRESS', stoppage_category: null }),
    ).toBe('RUNNING');
  });

  it('prefers open stoppage order over stale running event', () => {
    expect(
      resolveMachineLiveStatus(undefined, { event_type: 'RUNNING_STARTED' }, {
        status: 'STOPPAGE',
        stoppage_category: 'MECH',
      }),
    ).toBe('STOPPAGE');
  });

  it('ignores stale running event without in-progress order', () => {
    expect(
      resolveMachineLiveStatus(undefined, { event_type: 'RUNNING_STARTED' }, undefined),
    ).toBe('IDLE');
  });

  it('maps master OFFLINE ahead of live events/orders', () => {
    expect(
      resolveMachineLiveStatus('OFFLINE', { event_type: 'RUNNING_STARTED' }, {
        status: 'IN_PROGRESS',
        stoppage_category: null,
      }),
    ).toBe('OFFLINE');
  });

  it('uses stoppage start for stoppage timer', () => {
    const since = resolveStateSinceAt('STOPPAGE', undefined, {
      stoppage_start_at: '2026-06-10T10:00:00.000Z',
    });
    expect(since?.toISOString()).toBe('2026-06-10T10:00:00.000Z');
  });

  it('uses prod start for running timer', () => {
    const since = resolveStateSinceAt('RUNNING', undefined, {
      prod_start_at: '2026-06-10T09:00:00.000Z',
    });
    expect(since?.toISOString()).toBe('2026-06-10T09:00:00.000Z');
  });
});
