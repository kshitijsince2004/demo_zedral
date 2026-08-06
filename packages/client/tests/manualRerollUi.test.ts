import { describe, expect, it } from 'vitest';
import {
  countRerollFilters,
  formatManualRerollConflict,
  formatRerollNetRuntime,
  formatRerollSummaryCard,
  manualRerollUiFlags,
  matchesRerollStatusFilter,
  parseRerollQuantity,
  rerollCombineKey,
  rerollNetRuntimeMs,
  showManualRerollEnterButton,
  withManualRerollTab,
} from '../src/lib/manualRerollUi';

describe('manualRerollUiFlags', () => {
  it('hides entry when the tenant flag is off', () => {
    expect(manualRerollUiFlags({ flagOn: false, role: 'OPERATOR', hasMachineAccess: true })).toEqual({
      showEntry: false,
      canWrite: false,
    });
  });

  it('hides entry without machine access', () => {
    expect(manualRerollUiFlags({ flagOn: true, role: 'OPERATOR', hasMachineAccess: false })).toEqual({
      showEntry: false,
      canWrite: false,
    });
  });

  it('gives operators write controls', () => {
    expect(manualRerollUiFlags({ flagOn: true, role: 'OPERATOR', hasMachineAccess: true })).toEqual({
      showEntry: true,
      canWrite: true,
    });
  });

  it('gives admin write controls and others read-only', () => {
    expect(manualRerollUiFlags({ flagOn: true, role: 'ADMIN', hasMachineAccess: true }).canWrite).toBe(true);
    expect(manualRerollUiFlags({ flagOn: true, role: 'MACHINE_HEAD', hasMachineAccess: true })).toEqual({
      showEntry: true,
      canWrite: false,
    });
    expect(manualRerollUiFlags({ flagOn: true, role: 'SUPERVISOR', hasMachineAccess: true }).canWrite).toBe(false);
    expect(manualRerollUiFlags({ flagOn: true, role: 'PLANT_HEAD', hasMachineAccess: true }).canWrite).toBe(false);
  });
});

describe('manual reroll helpers', () => {
  it('parses happy-path quantity and rejects junk', () => {
    expect(parseRerollQuantity('1.25')).toBe(1.25);
    expect(parseRerollQuantity('0')).toBeNull();
    expect(parseRerollQuantity('')).toBeNull();
  });

  it('formats 409 blocked message with active batch', () => {
    expect(formatManualRerollConflict(
      { error: 'Machine is running a normal production order', activeBatchNumber: 'LIVE-9' },
      'Start failed',
    )).toBe('Machine is running a normal production order (LIVE-9)');
  });

  it('renders summary totals', () => {
    expect(formatRerollSummaryCard(null)).toEqual({ total: '—', detail: 'No summary yet' });
    expect(formatRerollSummaryCard({ totalRerollMt: 2.5, sessionCount: 1 })).toEqual({
      total: '2.500 MT',
      detail: '1 completed session today',
    });
  });

  it('appends the gated hub tab only when enabled', () => {
    const base = [{ id: 'rolling', label: 'Rolling' }];
    expect(withManualRerollTab(base, false)).toEqual(base);
    expect(withManualRerollTab(base, true).at(-1)).toMatchObject({ id: 'reroll' });
  });

  it('hides enter button once pill tab is used', () => {
    expect(showManualRerollEnterButton(false, '6HI', 'rolling')).toBe(false);
    expect(showManualRerollEnterButton(true, '6HI', 'rolling')).toBe(false);
  });

  it('combines pending orders by coil + slit + finish family', () => {
    const a = { batchNumber: '1', coilNo: 'C1', slitId: 'A', rollFinish: 'MATT', subProcess: 'ROLLING' };
    const b = { batchNumber: '2', coilNo: 'C1', slitId: 'A', rollFinish: 'LOW_MATT', subProcess: 'ROLLING' };
    const c = { batchNumber: '3', coilNo: 'C1', slitId: 'B', rollFinish: 'MATT', subProcess: 'ROLLING' };
    const d = { batchNumber: '4', coilNo: 'C1', slitId: 'A', rollFinish: 'MATT', subProcess: 'SKIN_PASS' };
    expect(rerollCombineKey(a)).toBe(rerollCombineKey(b));
    expect(rerollCombineKey(a)).not.toBe(rerollCombineKey(c));
    expect(rerollCombineKey(a)).not.toBe(rerollCombineKey(d));
  });

  it('buckets STOPPAGE under In Progress and PREPARING under Pending', () => {
    expect(matchesRerollStatusFilter('STOPPAGE', 'IN_PROGRESS')).toBe(true);
    expect(matchesRerollStatusFilter('ON_HOLD', 'ON_HOLD')).toBe(true);
    expect(matchesRerollStatusFilter('PENDING', 'PENDING')).toBe(true);
    expect(matchesRerollStatusFilter('PREPARING', 'PENDING')).toBe(true);
    expect(countRerollFilters([
      { status: 'PENDING' },
      { status: 'PREPARING' },
      { status: 'IN_PROGRESS' },
      { status: 'STOPPAGE' },
      { status: 'ON_HOLD' },
      { status: 'COMPLETED' },
    ])).toEqual({
      ALL: 6,
      PENDING: 2,
      IN_PROGRESS: 2,
      ON_HOLD: 1,
      COMPLETED: 1,
    });
  });

  it('computes net runtime excluding stoppages', () => {
    const start = '2026-08-06T10:00:00.000Z';
    const now = Date.parse('2026-08-06T10:20:00.000Z');
    const ms = rerollNetRuntimeMs(start, [
      { startTime: '2026-08-06T10:05:00.000Z', endTime: '2026-08-06T10:10:00.000Z' },
    ], now);
    expect(ms).toBe(15 * 60_000);
    expect(formatRerollNetRuntime(ms)).toBe('00:15:00');
  });
});
