import { describe, expect, it } from 'vitest';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import {
  netProductionRuntimeMs,
  resolveProductionDurationMin,
  totalStoppageMs,
} from '../../src/lib/sixHiRuntime';

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

    expect(netProductionRuntimeMs(detail)).toBe(100 * 60_000);
    expect(totalStoppageMs(detail, false)).toBe(20 * 60_000);
  });

  it('counts live elapsed only for the active stoppage row', () => {
    const stopStart = new Date(Date.now() - 5 * 60_000);
    const detail = order({
      status: 'STOPPAGE',
      prodStartAt: new Date(Date.now() - 60 * 60_000).toISOString(),
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
        durationMin: 0,
      }],
    });

    const ms = totalStoppageMs(detail, true);
    expect(ms).toBeGreaterThan(4 * 60_000);
    expect(ms).toBeLessThan(6 * 60_000);
  });

  it('does not deduct stale open stoppage rows after activeStoppage is cleared', () => {
    const prodStart = new Date(Date.now() - 60 * 60_000);
    const stopStart = new Date(Date.now() - 10 * 60_000);
    const detail = order({
      status: 'IN_PROGRESS',
      prodStartAt: prodStart.toISOString(),
      stoppages: [{
        id: 's1',
        categoryCode: '12',
        categoryLabel: 'Operational',
        startAt: stopStart.toISOString(),
      }],
    });

    const net = netProductionRuntimeMs(detail);
    expect(net).not.toBeNull();
    expect(net!).toBeGreaterThan(59 * 60_000);
  });

  it('resumes net runtime after stoppage ends using closed timestamps', () => {
    const prodStart = new Date(Date.now() - 60 * 60_000);
    const stopStart = new Date(Date.now() - 30 * 60_000);
    const stopEnd = new Date(Date.now() - 20 * 60_000);
    const detail = order({
      status: 'IN_PROGRESS',
      prodStartAt: prodStart.toISOString(),
      stoppages: [{
        id: 's1',
        categoryCode: '12',
        categoryLabel: 'Operational',
        startAt: stopStart.toISOString(),
        endAt: stopEnd.toISOString(),
        durationMin: 10,
      }],
    });

    const net = netProductionRuntimeMs(detail)!;
    expect(net).toBeGreaterThan(49 * 60_000);
    expect(net).toBeLessThan(51 * 60_000);
  });

  it('sums multiple completed stoppages for net runtime', () => {
    const start = new Date('2026-07-26T08:00:00.000Z');
    const end = new Date('2026-07-26T12:00:00.000Z');
    const detail = order({
      status: 'COMPLETED',
      prodStartAt: start.toISOString(),
      prodEndAt: end.toISOString(),
      stoppages: [
        {
          id: 's1',
          categoryCode: '12',
          categoryLabel: 'Operational',
          startAt: '2026-07-26T09:00:00.000Z',
          endAt: '2026-07-26T09:15:00.000Z',
          durationMin: 15,
        },
        {
          id: 's2',
          categoryCode: '12',
          categoryLabel: 'Operational',
          startAt: '2026-07-26T10:00:00.000Z',
          endAt: '2026-07-26T10:10:00.000Z',
          durationMin: 10,
        },
      ],
    });

    expect(totalStoppageMs(detail, false)).toBe(25 * 60_000);
    expect(netProductionRuntimeMs(detail)).toBe(215 * 60_000);
  });

  it('freezes net runtime while a stoppage is active', () => {
    const start = new Date(Date.now() - 60 * 60_000);
    const stopStart = new Date(Date.now() - 10 * 60_000);
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
    expect(net!).toBeGreaterThan(49 * 60_000);
    expect(net!).toBeLessThan(51 * 60_000);
  });

  it('derives production duration from timestamps when prodDurationMin is missing', () => {
    const detail = order({
      status: 'COMPLETED',
      prodStartAt: '2026-07-26T08:00:00.000Z',
      prodEndAt: '2026-07-26T10:00:00.000Z',
      stoppages: [{
        id: 's1',
        categoryCode: '12',
        categoryLabel: 'Operational',
        startAt: '2026-07-26T09:00:00.000Z',
        endAt: '2026-07-26T09:20:00.000Z',
        durationMin: 20,
      }],
    });

    expect(resolveProductionDurationMin(detail)).toBe(100);
  });
});
