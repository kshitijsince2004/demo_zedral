import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
    insertInto: vi.fn(),
    updateTable: vi.fn(),
    transaction: vi.fn(),
  },
}));

const mockCreate = vi.fn(async () => 'shift-log-99');
vi.mock('../src/services/shiftLogService', () => ({
  ShiftLogService: { create: (...args: unknown[]) => mockCreate(...args) },
}));

vi.mock('../src/services/ShiftBoundaryService', () => ({
  resolveBoundaryShifts: vi.fn(() => ({
    outgoingShiftCode: 'C',
    outgoingProdDate: '2026-07-09',
    incomingShiftCode: 'A',
    incomingProdDate: '2026-07-10',
  })),
}));

import { db } from '../src/db';
import { ShiftDetectionService } from '../src/services/ShiftDetectionService';
import { ShiftAttributionService } from '../src/services/ShiftAttributionService';

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  for (const m of [
    'select', 'selectAll', 'where', 'innerJoin', 'leftJoin', 'orderBy',
    'limit', 'groupBy', 'onConflict', 'values', 'set', 'returning',
    'executeTakeFirst', 'executeTakeFirstOrThrow', 'execute',
  ]) {
    c[m] = vi.fn(self);
  }
  (c.execute as ReturnType<typeof vi.fn>).mockResolvedValue(Array.isArray(result) ? result : result != null ? [result] : []);
  (c.executeTakeFirst as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  (c.executeTakeFirstOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  return c;
}

describe('shift attribution consolidation (T2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue('shift-log-99');
  });

  it('resolveShift with planDate+shiftCode creates/looks up shift log', async () => {
    const selectFrom = db.selectFrom as ReturnType<typeof vi.fn>;
    selectFrom.mockImplementation((table: string) => {
      if (table === 'master.process') return chain({ process_id: 3 });
      return chain(null);
    });

    const resolved = await ShiftDetectionService.resolveShift({
      planDate: '2026-07-10',
      shiftCode: 'A',
      userId: 1,
      processId: 3,
    });

    expect(resolved.shiftCode).toBe('A');
    expect(resolved.prodDate).toBe('2026-07-10');
    expect(resolved.shiftLogId).toBe('shift-log-99');
    expect(mockCreate).toHaveBeenCalled();
  });

  it('resolveShift with orderId uses existing attribution', async () => {
    const selectFrom = db.selectFrom as ReturnType<typeof vi.fn>;
    selectFrom.mockImplementation((table: string) => {
      if (table === 'txn.crm_order') {
        return chain({ shift_log_id: '42', prod_date: '2026-07-10', shift_code: 'B' });
      }
      if (table === 'txn.shift_log') {
        return chain({
          shift_log_id: '42',
          shift_code: 'B',
          prod_date: new Date('2026-07-10T00:00:00+05:30'),
          process_id: 3,
        });
      }
      return chain(null);
    });

    const resolved = await ShiftDetectionService.resolveShift({ orderId: '100' });
    expect(resolved.shiftLogId).toBe('42');
    expect(resolved.shiftCode).toBe('B');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('attributeOrder upserts via single writer', async () => {
    const selectFrom = db.selectFrom as ReturnType<typeof vi.fn>;
    const insertInto = db.insertInto as ReturnType<typeof vi.fn>;
    selectFrom.mockImplementation((table: string) => {
      if (table === 'txn.shift_log') {
        return chain({ shift_code: 'A', prod_date: new Date('2026-07-10T00:00:00+05:30') });
      }
      if (typeof table === 'string' && table.includes('crm_order')) {
        return chain({ machine_code: '6HI' });
      }
      // joins for assertRuntimeAccounting path
      return chain({ start_time: '06:00', end_time: '14:00' });
    });
    const insertChain = chain(null);
    insertInto.mockReturnValue(insertChain);

    await ShiftAttributionService.attributeOrder('55', 'shift-log-1', { machineCode: '6HI' });
    expect(insertInto).toHaveBeenCalledWith('txn.order_shift_attribution');
  });
});
