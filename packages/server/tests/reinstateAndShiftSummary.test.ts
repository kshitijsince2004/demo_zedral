import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
    updateTable: vi.fn(),
    deleteFrom: vi.fn(),
  },
}));

vi.mock('../src/services/MachineStateEventService', () => ({
  MachineStateEventService: {
    recordEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('SixHiService.reinstateOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is exported on SixHiExecutionService', async () => {
    const { SixHiExecutionService } = await import('../src/services/sixHi/SixHiExecutionService');
    expect(typeof SixHiExecutionService.reinstateOrder).toBe('function');
  });

  it('is exported on SixHiService', async () => {
    const { SixHiService } = await import('../src/services/SixHiService');
    expect(typeof SixHiService.reinstateOrder).toBe('function');
  });
});

describe('ShiftSummaryReport', () => {
  it('is registered in export definitions', async () => {
    const { getReportDefinition } = await import('../src/export/definitions/index');
    const def = getReportDefinition('SHIFT_SUMMARY');
    expect(def.id).toBe('SHIFT_SUMMARY');
    expect(def.supportedFormats()).toEqual(['CSV', 'XLSX', 'PDF']);
  });

  it('requires date and shiftCode in scope', async () => {
    const { getReportDefinition } = await import('../src/export/definitions/index');
    const def = getReportDefinition('SHIFT_SUMMARY');
    expect(() => def.validateScope({})).toThrow('date is required');
    expect(() => def.validateScope({ date: '2026-06-01' })).toThrow('shiftCode is required');
    expect(() => def.validateScope({ date: '2026-06-01', shiftCode: 'A' })).not.toThrow();
  });
});
