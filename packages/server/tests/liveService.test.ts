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

import { LiveService, resolveMachineLiveStatus, resolveStateSinceAt, resolveActiveProcessType } from '../src/services/LiveService';
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

describe('resolveActiveProcessType', () => {
  it('maps CRM rolling and skin pass when busy', () => {
    expect(resolveActiveProcessType({
      crmBusy: true,
      crmSubProcess: 'ROLLING',
    })).toBe('ROLLING');
    expect(resolveActiveProcessType({
      crmBusy: true,
      crmSubProcess: 'SKIN_PASS',
    })).toBe('SKIN_PASS');
  });

  it('maps CRM rewinding sub_process', () => {
    expect(resolveActiveProcessType({
      crmBusy: true,
      crmSubProcess: 'REWINDING',
    })).toBe('REWINDING');
  });

  it('prefers CRM over open re-roll', () => {
    expect(resolveActiveProcessType({
      crmBusy: true,
      crmSubProcess: 'ROLLING',
      openRerollStatus: 'IN_PROGRESS',
      openRwdStatus: 'IN_PROGRESS',
    })).toBe('ROLLING');
  });

  it('maps manual re-roll when CRM idle', () => {
    expect(resolveActiveProcessType({
      crmBusy: false,
      openRerollStatus: 'IN_PROGRESS',
    })).toBe('MANUAL_REROLL');
    expect(resolveActiveProcessType({
      crmBusy: false,
      openRerollStatus: 'ON_HOLD',
    })).toBe('MANUAL_REROLL');
  });

  it('maps open RWD when CRM and re-roll idle', () => {
    expect(resolveActiveProcessType({
      crmBusy: false,
      openRwdStatus: 'IN_PROGRESS',
    })).toBe('REWINDING');
  });

  it('prefers re-roll over RWD', () => {
    expect(resolveActiveProcessType({
      crmBusy: false,
      openRerollStatus: 'STOPPAGE',
      openRwdStatus: 'IN_PROGRESS',
    })).toBe('MANUAL_REROLL');
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

  it('treats open manual re-roll as running without CRM order', () => {
    expect(
      resolveMachineLiveStatus(undefined, { event_type: 'RUNNING_STARTED' }, undefined, {
        status: 'IN_PROGRESS',
      }),
    ).toBe('RUNNING');
  });

  it('treats open manual re-roll stoppage as STOPPAGE', () => {
    expect(
      resolveMachineLiveStatus(undefined, undefined, undefined, {
        status: 'STOPPAGE',
        stoppageCategory: 'MECH',
      }),
    ).toBe('STOPPAGE');
  });

  it('maps manual re-roll on hold to IDLE', () => {
    expect(
      resolveMachineLiveStatus(undefined, { event_type: 'IDLE_STARTED' }, undefined, {
        status: 'ON_HOLD',
      }),
    ).toBe('IDLE');
  });

  it('treats open RWD order as running without CRM or re-roll', () => {
    expect(
      resolveMachineLiveStatus(undefined, undefined, undefined, null, { status: 'IN_PROGRESS' }),
    ).toBe('RUNNING');
  });

  it('prefers CRM active order over re-roll overlay', () => {
    expect(
      resolveMachineLiveStatus(undefined, undefined, {
        status: 'IN_PROGRESS',
        stoppage_category: null,
      }, { status: 'STOPPAGE' }),
    ).toBe('RUNNING');
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
