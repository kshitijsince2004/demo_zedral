import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@zedral/platform', () => ({
  emitM1Event: vi.fn(),
}));

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
    fn: {
      count: vi.fn(() => ({ as: vi.fn(() => 'n') })),
      countAll: vi.fn(() => ({ as: vi.fn(() => 'cnt') })),
    },
  },
}));

import { db } from '../src/db';

function queryChain(result: unknown, terminal: 'executeTakeFirst' | 'execute' = 'executeTakeFirst') {
  const chain = {
    leftJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    [terminal]: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

describe('SixHiService.resolveOrderAssignmentContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the requested date and shift when assignable unallocated batches exist there', async () => {
    vi.mocked(db.selectFrom).mockReturnValue(
      queryChain({ n: 2 }) as never,
    );

    const { SixHiService } = await import('../src/services/SixHiService');
    const ctx = await SixHiService.resolveOrderAssignmentContext('2026-07-15', 'B');
    expect(ctx).toEqual({ planDate: '2026-07-15', shiftCode: 'B' });
    expect(db.selectFrom).toHaveBeenCalledTimes(1);
  });

  it('falls back to the latest unallocated plan when the requested shift only has allocated batches', async () => {
    let call = 0;
    vi.mocked(db.selectFrom).mockImplementation(() => {
      call += 1;
      if (call === 1) return queryChain({ n: 0 }) as never;
      if (call === 2) return queryChain([], 'execute') as never;
      return queryChain({ plan_date: new Date('2026-07-15'), shift_code: 'B' }) as never;
    });

    const { SixHiService } = await import('../src/services/SixHiService');
    const ctx = await SixHiService.resolveOrderAssignmentContext('2026-07-07', 'A');
    expect(ctx).toEqual({ planDate: '2026-07-15', shiftCode: 'B' });
    expect(db.selectFrom).toHaveBeenCalledTimes(3);
  });
});
