import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const CLOCK_A = {
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

describe('ShiftDetectionService.isSessionLive', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is false for yesterday C when now is today afternoon (stale overnight)', () => {
    // C prod_date=2026-07-09 ends 2026-07-10 06:00 + 2h grace → 08:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T14:00:00+05:30'));

    expect(
      ShiftDetectionService.isSessionLive({
        prod_date: '2026-07-09',
        start_time: '22:00',
        end_time: '06:00',
      }),
    ).toBe(false);
  });

  it('is true for C overtime within grace (06:30 after 06:00 end)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T06:30:00+05:30'));

    expect(
      ShiftDetectionService.isSessionLive({
        prod_date: '2026-07-09',
        start_time: '22:00',
        end_time: '06:00',
      }),
    ).toBe(true);
  });
});

describe('ShiftDetectionService.getCurrentShift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveShiftFromClock.mockReturnValue(CLOCK_A);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not pin stale yesterday C after grace; falls through to clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T14:00:00+05:30'));

    const sessionC = {
      shift_code: 'C',
      shift_name: 'Shift C',
      prod_date: new Date('2026-07-09T00:00:00+05:30'),
      start_time: '22:00',
      end_time: '06:00',
    };

    vi.mocked(db.selectFrom).mockImplementation((table: string) => {
      if (String(table).includes('master.shift')) return shiftTableChain() as never;
      if (String(table).includes('shift_override_audit')) return overrideChain(null) as never;
      return sessionChain(sessionC) as never;
    });

    const shift = await ShiftDetectionService.getCurrentShift({
      userId: 1,
      machineCode: '6HI',
    });

    expect(shift.shiftCode).toBe('A');
    expect(shift.prodDate).toBe('2026-07-10');
    expect(shift.source).toBe('FALLBACK');
  });

  it('pins ACTIVE session C during overtime grace after clock rolled to A', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T06:30:00+05:30'));

    const sessionC = {
      shift_code: 'C',
      shift_name: 'Shift C',
      prod_date: new Date('2026-07-09T00:00:00+05:30'),
      start_time: '22:00',
      end_time: '06:00',
    };

    vi.mocked(db.selectFrom).mockImplementation((table: string) => {
      if (String(table).includes('master.shift')) return shiftTableChain() as never;
      return sessionChain(sessionC) as never;
    });

    const shift = await ShiftDetectionService.getCurrentShift({
      userId: 1,
      machineCode: '6HI',
    });

    expect(shift.shiftCode).toBe('C');
    expect(shift.prodDate).toBe('2026-07-09');
    expect(shift.source).toBe('SESSION');
  });

  it('returns SESSION source when ACTIVE session matches the current operational shift', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T10:00:00+05:30'));

    const currentSession = {
      shift_code: 'A',
      shift_name: 'Shift A',
      prod_date: new Date('2026-07-10T00:00:00+05:30'),
      start_time: '06:00',
      end_time: '14:00',
    };

    vi.mocked(db.selectFrom).mockImplementation((table: string) => {
      if (String(table).includes('master.shift')) return shiftTableChain() as never;
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

  it('falls back to clock when machine has no ACTIVE session', async () => {
    vi.mocked(db.selectFrom).mockImplementation((table: string) => {
      if (String(table).includes('master.shift')) return shiftTableChain() as never;
      if (String(table).includes('shift_override_audit')) {
        return overrideChain(null) as never;
      }
      return sessionChain(null) as never;
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

  it('uses clock only when no machineCode (shift-change watcher)', async () => {
    vi.mocked(db.selectFrom).mockImplementation((table: string) => {
      if (String(table).includes('master.shift')) return shiftTableChain() as never;
      if (String(table).includes('shift_override_audit')) {
        return overrideChain(null) as never;
      }
      return sessionChain({ shift_code: 'C' }) as never;
    });

    const shift = await ShiftDetectionService.getCurrentShift({ userId: 1 });

    expect(shift.shiftCode).toBe('A');
    expect(shift.source).toBe('FALLBACK');
  });
});

describe('ShiftDetectionService.closeStaleOperatorSessions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes expired ACTIVE sessions and keeps live overtime', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T06:30:00+05:30'));

    const updateWhere = vi.fn().mockReturnThis();
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateExecute = vi.fn().mockResolvedValue(undefined);
    updateWhere.mockReturnValue({ execute: updateExecute });

    vi.mocked(db.updateTable).mockReturnValue({ set: updateSet } as never);
    vi.mocked(db.selectFrom).mockReturnValue({
      innerJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([
        // A from two days ago — dead
        {
          session_id: '9',
          prod_date: new Date('2026-07-08T00:00:00+05:30'),
          start_time: '06:00',
          end_time: '14:00',
          operator_user_id: 1,
        },
        // C overnight still in overtime grace — keep
        {
          session_id: '10',
          prod_date: new Date('2026-07-09T00:00:00+05:30'),
          start_time: '22:00',
          end_time: '06:00',
          operator_user_id: 1,
        },
      ]),
    } as never);

    const closed = await ShiftDetectionService.closeStaleOperatorSessions('6HI', 1);

    expect(closed).toBe(1);
    expect(db.updateTable).toHaveBeenCalledWith('txn.machine_shift_session');
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'CLOSED' }));
    expect(updateWhere).toHaveBeenCalledWith('session_id', 'in', ['9']);
  });
});
