import { describe, it, expect } from 'vitest';
import { parseRewindingPlanXlsx } from '../src/utils/rewindingPlanXlsxParser';

describe('parseRewindingPlanXlsx', () => {
  it('maps rewinding headers to RWD ppc_batch fields', () => {
    const XLSX = require('xlsx') as typeof import('xlsx');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        'Batch Number', 'Mother Coil', 'Slit ID', 'Customer Name', 'Width',
        'Pre Stage Thickness', 'Coil Weight', 'Surface', 'Grade',
        'From Work Center', 'To Work Center', 'Process Route',
        'Sale Order', 'Item No', 'Plan Date',
      ],
      [
        'BN-R1', '1100038398', 'G', 'VICTURA/AXIS', 705,
        1.55, 12.4, 'BRIGHT', 'CRCA',
        'R', 'F', 'SRFXCLE',
        'SO-1', '10', '2026-07-21',
      ],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Rewinding');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const result = parseRewindingPlanXlsx(buf, { shiftCode: 'A' });
    expect(result.headerError).toBeUndefined();
    expect(result.sheetType).toBe('REWINDING');
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];
    expect(row.errors).toEqual([]);
    expect(row.machineCode).toBe('RWD');
    expect(row.subProcess).toBe('RWD');
    expect(row.coilNo).toBe('1100038398');
    expect(row.slitId).toBe('G');
    expect(row.customerName).toBe('VICTURA/AXIS');
    expect(row.widthMm).toBe(705);
    expect(row.inputThkMm).toBe(1.55);
    expect(row.ppcWeightMt).toBe(12.4);
    expect(row.rollFinish).toBe('BRIGHT');
    expect(row.fromWorkCenter).toBe('R');
    expect(row.toWorkCenter).toBe('F');
    expect(row.processRouteCanonical).toContain('R');
  });

  it('targets 2HI when machine column is 2HI', () => {
    const XLSX = require('xlsx') as typeof import('xlsx');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        'Batch Number', 'Mother Coil', 'Slit ID', 'Customer Name', 'Width',
        'Pre Stage Thickness', 'Coil Weight', 'Surface', 'Grade',
        'From Work Center', 'To Work Center', 'Process Route',
        'Sale Order', 'Item No', 'Plan Date', 'Machine',
      ],
      [
        'BN-R2', '1100038399', 'G', 'VICTURA/AXIS', 705,
        1.55, 12.4, 'BRIGHT', 'CRCA',
        'R', 'F', 'SRFXCLE',
        'SO-1', '10', '2026-07-21', '2HI',
      ],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Rewinding');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const result = parseRewindingPlanXlsx(buf, { shiftCode: 'A' });
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.errors).toEqual([]);
    expect(row.machineCode).toBe('2HI');
    expect(row.subProcess).toBe('REWINDING');
    expect(row.fromWorkCenter).toBe('R');
  });
});