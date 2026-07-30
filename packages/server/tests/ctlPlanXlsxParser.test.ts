import { describe, it, expect } from 'vitest';
import { parseCtlPlanXlsx } from '../src/utils/ctlPlanXlsxParser';
import { parsePlanCount, distributeBundleWeightsKg } from '../src/utils/ctlFieldMappers';

describe('ctlFieldMappers', () => {
  it('parses Pcs cells like 1500 NO', () => {
    expect(parsePlanCount('1500 NO')).toBe(1500);
    expect(parsePlanCount('8 NOS')).toBe(8);
    expect(parsePlanCount(73)).toBe(73);
    expect(parsePlanCount('')).toBeNull();
  });

  it('distributes bundle weights by piece share', () => {
    expect(distributeBundleWeightsKg(100, [50, 50, 0, 0])).toEqual([50, 50, 0, 0]);
    expect(distributeBundleWeightsKg(90, [1, 2, 0, 0])).toEqual([30, 60, 0, 0]);
  });
});

describe('parseCtlPlanXlsx', () => {
  it('maps CTL plan headers including Length/Pcs/Prod. Version', () => {
    const XLSX = require('xlsx') as typeof import('xlsx');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        'Batch Number', 'Mother Coil', 'Slit ID', 'Customer Name', 'Width',
        'Pre Stage Thickness', 'Coil Weight', 'Length', 'Pcs', 'Grade',
        'From Work Center', 'To Work Center', 'Process Route',
        'Sale Order', 'Item No', 'Plan Date', 'Prod. Version', 'No of Rows',
      ],
      [
        '2005643788', '1100036818', 'B', 'K R AUTO COMPONENTS PVT. LTD.', 77,
        1.19, 0.31, 1020, '1500 NO', 'D',
        'L', 'E', 'SP4RFXCLE',
        '0000042175', '90', '2026-07-21', 'CTL5', '8 NOS',
      ],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'CTL');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const result = parseCtlPlanXlsx(buf, { shiftCode: 'C' });
    expect(result.headerError).toBeUndefined();
    expect(result.sheetType).toBe('CTL');
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];
    expect(row.errors).toEqual([]);
    expect(row.machineCode).toBe('CTL');
    expect(row.subProcess).toBe('CTL');
    expect(row.coilNo).toBe('1100036818');
    expect(row.slitId).toBe('B');
    expect(row.widthMm).toBe(77);
    expect(row.inputThkMm).toBe(1.19);
    expect(row.ppcWeightMt).toBe(0.31);
    expect(row.lengthMm).toBe(1020);
    expect(row.plannedPcs).toBe(1500);
    expect(row.noOfRows).toBe(8);
    expect(row.prodVersion).toBe('CTL5');
    expect(row.fromWorkCenter).toBe('L');
    expect(row.toWorkCenter).toBe('E');
    expect(row.processRouteCanonical).toContain('LE');
  });
});
