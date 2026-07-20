import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
  },
}));

vi.mock('../src/services/ShiftDetectionService', () => ({
  ShiftDetectionService: {
    resolveShift: vi.fn(async () => ({
      shiftLogId: 'primary-log',
      shiftCode: 'A',
      prodDate: '2026-07-16',
      processId: 3,
    })),
  },
}));

import { db } from '../src/db';
import { SixHiService } from '../src/services/SixHiService';

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  for (const m of ['select', 'where', 'execute', 'executeTakeFirst']) {
    c[m] = vi.fn(self);
  }
  (c.execute as ReturnType<typeof vi.fn>).mockResolvedValue(Array.isArray(result) ? result : []);
  (c.executeTakeFirst as ReturnType<typeof vi.fn>).mockResolvedValue(result);
  return c;
}

describe('SixHiService shift log sibling scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expandSiblingShiftLogIds returns all logs for same process/date/shift', async () => {
    const selectFrom = db.selectFrom as ReturnType<typeof vi.fn>;
    let shiftLogQuery = 0;
    selectFrom.mockImplementation((table: string) => {
      if (table !== 'txn.shift_log') return chain(null);
      shiftLogQuery += 1;
      if (shiftLogQuery === 1) {
        return chain({ prod_date: '2026-07-16', shift_code: 'A', process_id: 3 });
      }
      return chain([
        { shift_log_id: 'log-null' },
        { shift_log_id: 'log-6hi' },
        { shift_log_id: 'log-4hi' },
      ]);
    });

    const ids = await SixHiService.expandSiblingShiftLogIds('log-null');
    expect(ids).toEqual(['log-null', 'log-6hi', 'log-4hi']);
  });

  it('expandSiblingShiftLogIds falls back to primary when shift row missing', async () => {
    const selectFrom = db.selectFrom as ReturnType<typeof vi.fn>;
    selectFrom.mockImplementation(() => chain(null));

    const ids = await SixHiService.expandSiblingShiftLogIds('only-log');
    expect(ids).toEqual(['only-log']);
  });

  it('resolveShiftLogIdsForPlan expands resolved primary id', async () => {
    const selectFrom = db.selectFrom as ReturnType<typeof vi.fn>;
    let shiftLogQuery = 0;
    selectFrom.mockImplementation((table: string) => {
      if (table !== 'txn.shift_log') return chain(null);
      shiftLogQuery += 1;
      if (shiftLogQuery === 1) {
        return chain({ prod_date: '2026-07-16', shift_code: 'B', process_id: 3 });
      }
      return chain([{ shift_log_id: 'primary-log' }, { shift_log_id: 'sibling-log' }]);
    });

    vi.spyOn(SixHiService, 'getProcessId').mockResolvedValue(3);

    const ids = await SixHiService.resolveShiftLogIdsForPlan('2026-07-16', 'B');
    expect(ids).toEqual(['primary-log', 'sibling-log']);
  });
});
