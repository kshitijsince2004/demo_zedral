import { describe, it, expect, afterEach } from 'vitest';
import {
  getAutoBoundaryMode,
  isMachineOnAutoBoundaryAllowlist,
  resolveBoundaryShifts,
} from '../src/services/ShiftBoundaryService';
import { ShiftLogService } from '../src/services/shiftLogService';
import { nextPlantShift, addPlantDays, parsePlantDateOnly, formatPlantDate } from '@m1/shared-validation';

const WINDOWS = [
  { shift_code: 'A', name: 'Shift A', start_time: '06:00', end_time: '14:00' },
  { shift_code: 'B', name: 'Shift B', start_time: '14:00', end_time: '22:00' },
  { shift_code: 'C', name: 'Shift C', start_time: '22:00', end_time: '06:00' },
];

describe('AUTO_BOUNDARY_HANDOVER flag', () => {
  const prev = process.env.AUTO_BOUNDARY_HANDOVER;
  const prevMachines = process.env.AUTO_BOUNDARY_HANDOVER_MACHINES;

  afterEach(() => {
    if (prev === undefined) delete process.env.AUTO_BOUNDARY_HANDOVER;
    else process.env.AUTO_BOUNDARY_HANDOVER = prev;
    if (prevMachines === undefined) delete process.env.AUTO_BOUNDARY_HANDOVER_MACHINES;
    else process.env.AUTO_BOUNDARY_HANDOVER_MACHINES = prevMachines;
  });

  it('defaults to off', () => {
    delete process.env.AUTO_BOUNDARY_HANDOVER;
    expect(getAutoBoundaryMode()).toBe('off');
  });

  it('accepts shadow and on', () => {
    process.env.AUTO_BOUNDARY_HANDOVER = 'shadow';
    expect(getAutoBoundaryMode()).toBe('shadow');
    process.env.AUTO_BOUNDARY_HANDOVER = 'on';
    expect(getAutoBoundaryMode()).toBe('on');
  });

  it('machine allowlist empty = all', () => {
    delete process.env.AUTO_BOUNDARY_HANDOVER_MACHINES;
    expect(isMachineOnAutoBoundaryAllowlist('CRM1')).toBe(true);
  });

  it('machine allowlist filters', () => {
    process.env.AUTO_BOUNDARY_HANDOVER_MACHINES = 'CRM1, PKL1';
    expect(isMachineOnAutoBoundaryAllowlist('CRM1')).toBe(true);
    expect(isMachineOnAutoBoundaryAllowlist('CRM2')).toBe(false);
  });
});

describe('A→B→C→A shift cycle (nextPlantShift / getNextShift)', () => {
  it('A → B same prod date', () => {
    expect(nextPlantShift('A', '2026-07-09')).toEqual({ shiftCode: 'B', prodDate: '2026-07-09' });
    const g = ShiftLogService.getNextShift('A', parsePlantDateOnly('2026-07-09'));
    expect(g.nextShiftCode).toBe('B');
    expect(formatPlantDate(g.nextProdDate)).toBe('2026-07-09');
  });

  it('B → C same prod date', () => {
    expect(nextPlantShift('B', '2026-07-09')).toEqual({ shiftCode: 'C', prodDate: '2026-07-09' });
  });

  it('C → A rolls production date +1', () => {
    expect(nextPlantShift('C', '2026-07-09')).toEqual({ shiftCode: 'A', prodDate: '2026-07-10' });
    const g = ShiftLogService.getNextShift('C', parsePlantDateOnly('2026-07-09'));
    expect(g.nextShiftCode).toBe('A');
    expect(formatPlantDate(g.nextProdDate)).toBe('2026-07-10');
  });

  it('continuous A→B→C→A cycle over two days', () => {
    let code = 'A';
    let date = '2026-07-09';
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = nextPlantShift(code, date);
      seen.push(`${code}@${date}→${next.shiftCode}@${next.prodDate}`);
      code = next.shiftCode;
      date = next.prodDate;
    }
    expect(seen).toEqual([
      'A@2026-07-09→B@2026-07-09',
      'B@2026-07-09→C@2026-07-09',
      'C@2026-07-09→A@2026-07-10',
      'A@2026-07-10→B@2026-07-10',
    ]);
  });

  it('month-end C→A rollover (Jul 31 → Aug 1)', () => {
    expect(nextPlantShift('C', '2026-07-31')).toEqual({ shiftCode: 'A', prodDate: '2026-08-01' });
  });

  it('year-end C→A rollover (Dec 31 → Jan 1)', () => {
    expect(nextPlantShift('C', '2026-12-31')).toEqual({ shiftCode: 'A', prodDate: '2027-01-01' });
  });

  it('addPlantDays matches C→A date step', () => {
    expect(addPlantDays('2026-07-09', 1)).toBe('2026-07-10');
    expect(addPlantDays('2026-07-31', 1)).toBe('2026-08-01');
  });
});

describe('resolveBoundaryShifts clock boundaries', () => {
  it('A→B at 14:00', () => {
    const r = resolveBoundaryShifts(WINDOWS, new Date('2026-06-08T14:00:00'));
    expect(r).toMatchObject({
      outgoingShiftCode: 'A',
      outgoingProdDate: '2026-06-08',
      incomingShiftCode: 'B',
      incomingProdDate: '2026-06-08',
    });
  });

  it('B→C at 22:00', () => {
    const r = resolveBoundaryShifts(WINDOWS, new Date('2026-06-08T22:00:00'));
    expect(r).toMatchObject({
      outgoingShiftCode: 'B',
      outgoingProdDate: '2026-06-08',
      incomingShiftCode: 'C',
      incomingProdDate: '2026-06-08',
    });
  });

  it('C→A at 06:00 (prod date rollover)', () => {
    const r = resolveBoundaryShifts(WINDOWS, new Date('2026-06-09T06:00:00'));
    expect(r).toMatchObject({
      outgoingShiftCode: 'C',
      outgoingProdDate: '2026-06-08',
      incomingShiftCode: 'A',
      incomingProdDate: '2026-06-09',
    });
  });

  it('C→A at month end midnight boundary', () => {
    // 06:00 Aug 1 → outgoing C of Jul 31, incoming A of Aug 1
    const r = resolveBoundaryShifts(WINDOWS, new Date('2026-08-01T06:00:00'));
    expect(r.outgoingShiftCode).toBe('C');
    expect(r.outgoingProdDate).toBe('2026-07-31');
    expect(r.incomingShiftCode).toBe('A');
    expect(r.incomingProdDate).toBe('2026-08-01');
  });

  it('Tier1 getNextShift agrees with resolveBoundaryShifts for C→A', () => {
    const clock = resolveBoundaryShifts(WINDOWS, new Date('2026-06-09T06:00:00'));
    const fromSession = ShiftLogService.getNextShift(
      clock.outgoingShiftCode,
      parsePlantDateOnly(clock.outgoingProdDate),
    );
    expect(fromSession.nextShiftCode).toBe(clock.incomingShiftCode);
    expect(formatPlantDate(fromSession.nextProdDate)).toBe(clock.incomingProdDate);
  });
});

describe('reparentOpenWork is the single carry-forward entry', () => {
  it('exports reparentOpenWork from carryForward module', async () => {
    const mod = await import('../src/services/handover/carryForward');
    expect(typeof mod.reparentOpenWork).toBe('function');
  });
});

describe('buildAutoRemarks (SPEC2 §13 B2)', () => {
  it('meets ≥20 char rule and includes boundary facts', async () => {
    const { buildAutoRemarks } = await import('../src/services/ShiftBoundaryService');
    const text = buildAutoRemarks({
      outgoingShiftCode: 'A',
      incomingShiftCode: 'B',
      totalProdMt: 12.5,
      openOrderCount: 2,
      carriedBatches: ['BATCH-1', 'BATCH-2'],
      stoppageMin: 15,
      breakdownMin: 0,
      machineStatus: 'IDLE',
    });
    expect(text.length).toBeGreaterThanOrEqual(20);
    expect(text).toContain('A→B');
    expect(text).toContain('12.500');
    expect(text).toContain('BATCH-1');
    expect(text).toContain('IDLE');
    expect(text).toMatch(/System-generated at shift boundary/i);
  });

  it('handles empty carry list', async () => {
    const { buildAutoRemarks } = await import('../src/services/ShiftBoundaryService');
    const text = buildAutoRemarks({
      outgoingShiftCode: 'C',
      incomingShiftCode: 'A',
      totalProdMt: 0,
      openOrderCount: 0,
      carriedBatches: [],
      stoppageMin: 0,
      breakdownMin: 0,
      machineStatus: 'RUNNING',
    });
    expect(text).toContain('Carried forward: none');
  });
});

describe('DeskNotificationService API surface (SPEC2 §10)', () => {
  it('exports notify + resolve helpers', async () => {
    const mod = await import('../src/services/DeskNotificationService');
    expect(typeof mod.DeskNotificationService.notifyMachineHeadsAutoHandover).toBe('function');
    expect(typeof mod.DeskNotificationService.resolveForShiftLog).toBe('function');
    expect(typeof mod.DeskNotificationService.listOpenForUser).toBe('function');
  });
});

describe('shadow mode contract', () => {
  it('processStaleSessions is exported and shadow is a valid mode', async () => {
    const { getAutoBoundaryMode, ShiftBoundaryService } = await import(
      '../src/services/ShiftBoundaryService'
    );
    process.env.AUTO_BOUNDARY_HANDOVER = 'shadow';
    expect(getAutoBoundaryMode()).toBe('shadow');
    expect(typeof ShiftBoundaryService.processStaleSessions).toBe('function');
    expect(typeof ShiftBoundaryService.autoCarryForwardStale).toBe('function');
  });
});
