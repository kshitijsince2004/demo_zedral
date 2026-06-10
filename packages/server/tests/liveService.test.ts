import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
  },
}));

vi.mock('../src/services/SixHiService', () => ({
  SixHiService: {
    toPlanDate: (d: string) => d,
    resolveOrderWeight: vi.fn(async (_orderId: string, _sub: string, ppc: number) => ppc + 1),
  },
}));

import { LiveService } from '../src/services/LiveService';
import { db } from '../src/db';
import { SixHiService } from '../src/services/SixHiService';

function mockCompletedRows(rows: Array<{ order_id: string; sub_process: string; ppc_weight_mt: number }>) {
  const chain = {
    innerJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.selectFrom).mockReturnValue(chain as never);
}

describe('LiveService.getShiftCompletedProductionMt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sums actual weights from completed orders in shift scope', async () => {
    mockCompletedRows([
      { order_id: '1', sub_process: 'ROLLING', ppc_weight_mt: 10 },
      { order_id: '2', sub_process: 'SKIN_PASS', ppc_weight_mt: 20 },
    ]);

    const result = await LiveService.getShiftCompletedProductionMt(['6HI'], '2026-06-10', 'A');

    expect(SixHiService.resolveOrderWeight).toHaveBeenCalledTimes(2);
    expect(result.completedOrderCount).toBe(2);
    expect(result.actualMt).toBe(32);
  });

  it('returns zero when machine scope is empty', async () => {
    const result = await LiveService.getShiftCompletedProductionMt([], '2026-06-10', 'A');
    expect(result).toEqual({ actualMt: 0, completedOrderCount: 0 });
    expect(db.selectFrom).not.toHaveBeenCalled();
  });
});
