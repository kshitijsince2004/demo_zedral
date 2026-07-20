import { describe, it, expect } from 'vitest';
import { parseRollingPlanXlsx } from '../src/utils/rollingPlanXlsxParser';

describe('rollingPlanXlsxParser empty batch and width', () => {
  it('surfaces empty batch number as row error instead of silently skipping', () => {
    const XLSX = require('xlsx') as typeof import('xlsx');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Batch Number', 'Mother Coil', 'Customer Name', 'Grade', 'Finish Thickness', 'Pre Stage Thickness', 'Coil Weight', 'Width', 'Process Route', 'Plan Date', 'Count'],
      ['', 'COIL-1', 'Hero Steels', 'CRCA', 0.5, 2.0, 12.5, 1000, 'SP4RFXCZ', '2026-06-08', 1],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Rolling');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const result = parseRollingPlanXlsx(buf, { sheetType: 'ROLLING', shiftCode: 'B' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].errors).toContain('Empty batch number');
  });

  it('surfaces zero/missing width as row error', () => {
    const XLSX = require('xlsx') as typeof import('xlsx');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Batch Number', 'Mother Coil', 'Customer Name', 'Grade', 'Finish Thickness', 'Pre Stage Thickness', 'Coil Weight', 'Width', 'Process Route', 'Plan Date', 'Count'],
      ['B-WIDTH', 'COIL-2', 'Hero Steels', 'CRCA', 0.5, 2.0, 12.5, 0, 'SP4RFXCZ', '2026-06-08', 1],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Rolling');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const result = parseRollingPlanXlsx(buf, { sheetType: 'ROLLING', shiftCode: 'B' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].errors.some((e) => e.includes('Width'))).toBe(true);
  });
});
