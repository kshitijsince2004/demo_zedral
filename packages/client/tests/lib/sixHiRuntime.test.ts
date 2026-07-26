import { describe, expect, it } from 'vitest';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { netProductionRuntimeMs, totalStoppageMs } from '../../src/lib/sixHiRuntime';

function order(overrides: Partial<SixHiOrderDetail>): SixHiOrderDetail {
  return {
    orderId: '1',
    batchNumber: 'B1',
    status: 'IN_PROGRESS',
    subProcess: 'ROLLING',
    motherCoil: 'MC',
    customer: 'C',
    grade: 'G',
    widthMm: 1000,
    inputThkMm: 2,
    targetThkMm: 1,
    finishThkMm: 1,
    rollFinish: 'MATT',
    weightMt: 10,
    remarks: [],
    stoppages: [],
    rollChanges: [],
    ...overrides,
  } as SixHiOrderDetail;
}

describe('sixHiRuntime', () => {
  it('excludes completed stoppage duration from net runtime', () => {
    const start = new Date('2026-07-26T08:00:00.000Z');
    const end = new Date('2026-07-26T10:00:00.000Z');
    const detail = order({
      status: 'COMPLETED',
      prodStartAt: start.toISOString(),
      prodEndAt: end.toISOString(),
      stoppages: [{
        id: 's1',
        categoryCode: '12',
        categoryLabel: 'Operational',
        startAt: '2026-07-26T09:00:00.000Z',
        endAt: '2026-07-26T09:20:00.000Z',
        durationMin: 20,
      }],
    });

    // 120 min wall − 20 min stoppage = 100 min = 6_000_000 ms
    expect(netProductionRuntimeMs(detail)).toBe(100 * 60_000);
    expect(totalStoppageMs(detail, false)).toBe(20 * 60_000);
  });

  it('freezes net runtime while a stoppage is active', () => {
    const start = new Date(Date.now() - 60 * 60_000); // started 60 min ago
    const stopStart = new Date(Date.now() - 10 * 60_000); // stopped 10 min ago
    const detail = order({
      status: 'STOPPAGE',
      prodStartAt: start.toISOString(),
      activeStoppage: {
        id: 's1',
        categoryCode: '12',
        categoryLabel: 'Operational',
        startAt: stopStart.toISOString(),
      },
      stoppages: [{
        id: 's1',
        categoryCode: '12',
        categoryLabel: 'Operational',
        startAt: stopStart.toISOString(),
      }],
    });

    const net = netProductionRuntimeMs(detail);
    expect(net).not.toBeNull();
    // ~50 minutes (±2s for test timing)
    expect(net!).toBeGreaterThan(49 * 60_000);
    expect(net!).toBeLessThan(51 * 60_000);
  });
});
