import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
    updateTable: vi.fn(),
    insertInto: vi.fn(),
  },
}));

const mockIsSessionLiveById = vi.fn();
const mockCloseStale = vi.fn();
const mockCloseStaleOnMachine = vi.fn();
const mockGetCurrentShift = vi.fn();

vi.mock('../src/services/ShiftDetectionService', () => ({
  ShiftDetectionService: {
    isSessionLiveById: (...args: unknown[]) => mockIsSessionLiveById(...args),
    closeStaleOperatorSessions: (...args: unknown[]) => mockCloseStale(...args),
    closeStaleSessionsOnMachine: (...args: unknown[]) => mockCloseStaleOnMachine(...args),
    getCurrentShift: (...args: unknown[]) => mockGetCurrentShift(...args),
  },
}));

vi.mock('../src/services/handover/OrderSource', () => ({
  getOrderSourceStrategy: () => ({
    ensureActiveShiftLog: vi.fn().mockResolvedValue('shift-log-1'),
  }),
}));

import { db } from '../src/db';
import { MachineHandoverService } from '../src/services/MachineHandoverService';

describe('MachineHandoverService.ensureActiveSession stale session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(MachineHandoverService, 'getPendingForMachine').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closes a stale ACTIVE session and opens a fresh clock-shift session', async () => {
    const existing = {
      session_id: 'stale-1',
      machine_code: '6HI',
      operator_user_id: 7,
      prod_date: new Date('2026-07-09'),
      shift_code: 'C',
      status: 'ACTIVE',
    };

    mockIsSessionLiveById.mockResolvedValue(false);
    mockCloseStale.mockResolvedValue(1);
    mockCloseStaleOnMachine.mockResolvedValue(0);
    mockGetCurrentShift.mockResolvedValue({
      shiftCode: 'A',
      shiftName: 'Shift A',
      prodDate: '2026-07-10',
      windowStart: '06:00',
      windowEnd: '14:00',
      detectedAt: new Date().toISOString(),
      source: 'FALLBACK',
    });

    const selectChains = [
      () => ({
        selectAll: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(existing),
      }),
      () => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      }),
      () => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue({ process_code: 'ROLLING', process_id: 1 }),
      }),
    ];
    let selectIdx = 0;
    vi.mocked(db.selectFrom).mockImplementation(() => {
      const factory = selectChains[Math.min(selectIdx++, selectChains.length - 1)];
      return factory() as never;
    });

    const newSession = {
      session_id: 'fresh-1',
      machine_code: '6HI',
      shift_code: 'A',
      prod_date: new Date('2026-07-10'),
      operator_user_id: 7,
      status: 'ACTIVE',
      shift_log_id: 'shift-log-1',
    };
    vi.mocked(db.insertInto).mockReturnValue({
      values: vi.fn().mockReturnThis(),
      returningAll: vi.fn().mockReturnThis(),
      executeTakeFirstOrThrow: vi.fn().mockResolvedValue(newSession),
    } as never);

    const result = await MachineHandoverService.ensureActiveSession('6HI', 7);

    expect(mockIsSessionLiveById).toHaveBeenCalledWith('stale-1');
    expect(mockCloseStale).toHaveBeenCalledWith('6HI', 7);
    expect(mockCloseStaleOnMachine).toHaveBeenCalledWith('6HI');
    expect(result.session).toEqual(newSession);
    expect(result.pendingHandover).toBeNull();
  });

  it('closes other operators stale ACTIVE before conflict check', async () => {
    mockIsSessionLiveById.mockResolvedValue(false);
    mockCloseStale.mockResolvedValue(0);
    mockCloseStaleOnMachine.mockResolvedValue(1);
    mockGetCurrentShift.mockResolvedValue({
      shiftCode: 'B',
      shiftName: 'Shift B',
      prodDate: '2026-07-10',
      windowStart: '14:00',
      windowEnd: '22:00',
      detectedAt: new Date().toISOString(),
      source: 'FALLBACK',
    });

    const selectChains = [
      () => ({
        selectAll: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      }),
      () => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      }),
      () => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue({ process_code: 'ROLLING', process_id: 1 }),
      }),
    ];
    let selectIdx = 0;
    vi.mocked(db.selectFrom).mockImplementation(() => {
      const factory = selectChains[Math.min(selectIdx++, selectChains.length - 1)];
      return factory() as never;
    });

    vi.mocked(db.insertInto).mockReturnValue({
      values: vi.fn((v: Record<string, unknown>) => {
        expect(v.shift_log_id).toBe('shift-log-1');
        return {
          returningAll: vi.fn().mockReturnThis(),
          executeTakeFirstOrThrow: vi.fn().mockResolvedValue({
            session_id: 'fresh-2',
            ...v,
          }),
        };
      }),
    } as never);

    await MachineHandoverService.ensureActiveSession('6HI', 9);
    expect(mockCloseStaleOnMachine).toHaveBeenCalledWith('6HI');
  });

  it('reuses a live session without closing (same-shift login regression)', async () => {
    const existing = {
      session_id: 'live-1',
      machine_code: '6HI',
      operator_user_id: 7,
      prod_date: new Date('2026-07-10'),
      shift_code: 'A',
      status: 'ACTIVE',
    };

    mockIsSessionLiveById.mockResolvedValue(true);

    // 1) existing ACTIVE session  2) session_crew check (empty -> needsCrew)
    const selectChains = [
      () => ({
        selectAll: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(existing),
      }),
      () => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      }),
    ];
    let selectIdx = 0;
    vi.mocked(db.selectFrom).mockImplementation(() => {
      const factory = selectChains[Math.min(selectIdx++, selectChains.length - 1)];
      return factory() as never;
    });

    const result = await MachineHandoverService.ensureActiveSession('6HI', 7);

    expect(mockCloseStale).not.toHaveBeenCalled();
    expect(db.insertInto).not.toHaveBeenCalled();
    expect(result.session).toEqual(existing);
    expect(result.created).toBe(false);
    expect(result.needsCrew).toBe(true);
  });

});