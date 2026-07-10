import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveShiftFromClock = vi.fn();

vi.mock('@m1/shared-validation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@m1/shared-validation')>();
  return {
    ...actual,
    resolveShiftFromClock: (...args: unknown[]) => mockResolveShiftFromClock(...args),
  };
});

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
    updateTable: vi.fn(),
    insertInto: vi.fn(),
  },
}));

import { db } from '../src/db';
import { ShiftDetectionService } from '../src/services/ShiftDetectionService';

const WINDOWS = [
  { shift_code: 'A', name: 'Shift A', start_time: '06:00', end_time: '14:00' },
  { shift_code: 'B', name: 'Shift B', start_time: '14:00', end_time: '22:00' },
  { shift_code: 'C', name: 'Shift C', start_time: '22:00', end_time: '06:00' },
];

const OPERATIONAL = {
  shiftCode: 'A',
  shiftName: 'Shift A',
  prodDate: '2026-07-10',
  window: WINDOWS[0],
};

function shiftTableChain() {
  return {
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(WINDOWS),
  };
}

function sessionChain(result: unknown) {
  return {
    innerJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
    execute: vi.fn().mockResolvedValue([]),
  };
}

function overrideChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue(result),
  };
}

describe('ShiftDetectionService.getCurrentShift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveShiftFromClock.mockReturnValue(OPERATIONAL);
  });

  it('returns clock shift when ACTIVE session is on a historical prod_date', async () => {
    const staleSession = {
      shift_code: 'A',
      shift_name: 'Shift A',
      prod_date: new Date('2026-07-03'),
      start_time: '06:00',
      end_time: '14:00',
    };

    vi.mocked(db.selectFrom).mockImplementation((table: string) => {
      if (String(table).includes('master.shift')) return shiftTableChain() as never;
      if (String(table).includes('shift_override_audit')) {
        return overrideChain(null) as never;
      }
      return sessionChain(staleSession) as never;
    });

    const shift = await ShiftDetectionService.getCurrentShift({
      userId: 1,
      machineCode: '6HI',
    });

    expect(shift.prodDate).toBe('2026-07-10');
    expect(shift.shiftCode).toBe('A');
    expect(shift.source).toBe('FALLBACK');
    expect(mockResolveShiftFromClock).toHaveBeenCalled();
  });

  it('returns SESSION source when ACTIVE session matches the current operational shift', async () => {
    const currentSession = {
      shift_code: 'A',
      shift_name: 'Shift A',
      prod_date: new Date('2026-07-10'),
      start_time: '06:00',
      end_time: '14:00',
    };

    vi.mocked(db.selectFrom).mockImplementation((table: string) => {
      if (String(table).includes('master.shift')) return shiftTableChain() as never;
      if (String(table).includes('shift_override_audit')) {
        return overrideChain(null) as never;
      }
      return sessionChain(currentSession) as never;
    });

    const shift = await ShiftDetectionService.getCurrentShift({
      userId: 1,
      machineCode: '6HI',
    });

    expect(shift.prodDate).toBe('2026-07-10');
    expect(shift.shiftCode).toBe('A');
    expect(shift.source).toBe('SESSION');
  });

  it('closes stale operator sessions that do not match operational shift', async () => {
    const updateWhere = vi.fn().mockReturnThis();
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateExecute = vi.fn().mockResolvedValue(undefined);
    updateWhere.mockReturnValue({ execute: updateExecute });

    vi.mocked(db.updateTable).mockReturnValue({ set: updateSet } as never);
    vi.mocked(db.selectFrom).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([
        { session_id: '9', prod_date: new Date('2026-07-03'), shift_code: 'B' },
        { session_id: '10', prod_date: new Date('2026-07-10'), shift_code: 'A' },
      ]),
    } as never);

    const closed = await ShiftDetectionService.closeStaleOperatorSessions(
      '6HI',
      1,
      '2026-07-10',
      'A',
    );

    expect(closed).toBe(1);
    expect(db.updateTable).toHaveBeenCalledWith('txn.machine_shift_session');
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CLOSED' }),
    );
  });
});
