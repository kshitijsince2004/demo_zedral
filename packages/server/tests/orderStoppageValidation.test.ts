import { describe, it, expect, vi, beforeEach } from 'vitest';

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
} from '../src/validation/orderStoppageValidation';
import {
  assertStoppageStartWithinShift,
  ManufacturingValidationError,
  resolveShiftWindowBounds,
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

    const startAt = new Date('2026-06-10T13:30:00');
    const endAt = new Date('2026-06-10T15:00:00');

    await expect(
      validateOrderStoppageInterval('42', startAt, endAt, '6'),
    ).resolves.toBeUndefined();
  });
});

describe('assertStoppageStartWithinShift', () => {
  it('allows stoppage end after shift boundary', () => {
    const bounds = resolveShiftWindowBounds('2026-06-10', '06:00', '14:00');
    expect(() =>
      assertStoppageStartWithinShift(new Date('2026-06-10T13:30:00'), bounds.start, bounds.end),
    ).not.toThrow();
  });
});
