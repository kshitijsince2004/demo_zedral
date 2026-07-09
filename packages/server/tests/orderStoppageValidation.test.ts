import { describe, it, expect, vi, beforeEach } from 'vitest';
import { plantClockDate } from '@m1/shared-validation';

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
    fn: {
      count: vi.fn(() => ({ as: vi.fn(() => 'c') })),
    },
  },
}));

import {
  assertCanStartOrderStoppage,
  validateOrderStoppageInterval,
  validateOrderStoppageStart,
} from '../src/validation/orderStoppageValidation';
import {
  assertStoppageStartWithinShift,
  ManufacturingValidationError,
  resolveShiftFromInstant,
  resolveShiftWindowBounds,
  stoppageStartWithinShift,
} from '../src/validation/manufacturingValidation';
import { db } from '../src/db';

describe('orderStoppageValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks duplicate active stoppages', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ c: 1 }),
    };
    vi.mocked(db.selectFrom).mockReturnValue(chain as never);

    await expect(assertCanStartOrderStoppage('42')).rejects.toThrow(ManufacturingValidationError);
  });

  it('allows ending a stoppage after shift end when start was in shift', async () => {
    const shiftRow = {
      plan_date: new Date('2026-06-10'),
      shift_code: 'B',
      start_time: '06:00:00',
      end_time: '14:00:00',
    };

    const orderChain = {
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(shiftRow),
    };

    const stoppageChain = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    };

    vi.mocked(db.selectFrom).mockImplementation((table: string) => {
      if (String(table).includes('order_stoppage')) return stoppageChain as never;
      return orderChain as never;
    });

    const startAt = plantClockDate('2026-06-10', '13:30');
    const endAt = plantClockDate('2026-06-10', '15:00');

    await expect(
      validateOrderStoppageInterval('42', startAt, endAt, '6'),
    ).resolves.toBeUndefined();
  });
});

describe('assertStoppageStartWithinShift', () => {
  it('allows stoppage end after shift boundary', () => {
    const bounds = resolveShiftWindowBounds('2026-06-10', '06:00', '14:00');
    expect(() =>
      assertStoppageStartWithinShift(plantClockDate('2026-06-10', '13:30'), bounds.start, bounds.end),
    ).not.toThrow();
  });

  it('detects start inside window via helper', () => {
    const bounds = resolveShiftWindowBounds('2026-06-10', '14:00', '22:00');
    const startAt = new Date('2026-06-10T10:30:00.000Z'); // 16:00 IST
    expect(stoppageStartWithinShift(startAt, bounds.start, bounds.end)).toBe(true);
  });
});

describe('validateOrderStoppageStart', () => {
  it('accepts stoppage when clock shift matches even if PPC plan differs', async () => {
    const orderRow = {
      sl_prod_date: new Date('2026-07-08'),
      sl_shift_code: 'A',
      o_prod_date: new Date('2026-07-09'),
      o_shift_code: 'B',
      pb_plan_date: new Date('2026-07-08'),
      pb_shift_code: 'A',
    };

    const orderChain = {
      leftJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(orderRow),
    };

    const shiftChain = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ start_time: '14:00:00', end_time: '22:00:00' }),
      execute: vi.fn().mockResolvedValue([
        { shift_code: 'A', start_time: '06:00:00', end_time: '14:00:00' },
        { shift_code: 'B', start_time: '14:00:00', end_time: '22:00:00' },
        { shift_code: 'C', start_time: '22:00:00', end_time: '06:00:00' },
      ]),
    };

    vi.mocked(db.selectFrom).mockImplementation((table: string) => {
      if (String(table).includes('master.shift')) return shiftChain as never;
      return orderChain as never;
    });

    const startAt = new Date('2026-07-09T10:30:00.000Z'); // 16:00 IST, Shift B
    await expect(validateOrderStoppageStart('42', startAt)).resolves.toBeUndefined();
  });
});

describe('resolveShiftFromInstant', () => {
  const WINDOWS = [
    { shift_code: 'A', start_time: '06:00', end_time: '14:00' },
    { shift_code: 'B', start_time: '14:00', end_time: '22:00' },
    { shift_code: 'C', start_time: '22:00', end_time: '06:00' },
  ];

  it('maps real UTC instants to overnight shift prod date in IST', () => {
    const at = new Date('2026-07-09T21:30:00.000Z'); // 2026-07-10 03:00 IST
    const detected = resolveShiftFromInstant(WINDOWS, at);
    expect(detected?.startTime).toBe('22:00');
    expect(detected?.prodDate).toBe('2026-07-09');
  });
});
