import { describe, it, expect } from 'vitest';
import { parseHrsPlanXlsx } from '../src/utils/hrsPlanXlsxParser';
import { parsePklPlanXlsx } from '../src/utils/pklPlanXlsxParser';
import { parseAnnPlanXlsx } from '../src/utils/annPlanXlsxParser';

function xlsxBuf(headers: string[], rows: unknown[] | unknown[][], sheetName = 'Sheet1'): Buffer {
  const XLSX = require('xlsx') as typeof import('xlsx');
  const wb = XLSX.utils.book_new();
  const normalizedRows = Array.isArray(rows[0]) ? (rows as unknown[][]) : [rows as unknown[]];
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...normalizedRows]);
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

const HRS_HEADERS = [
  'Batch Number', 'Plan Date', 'Shift', 'Mother Coil', 'Slit ID', 'Customer Name', 'Grade',
  'Width', 'Finish Thickness', 'Pre Stage Thinkness', 'Coil Weight', 'Count',
  'Act. Process Route', 'From Work Center', 'To Work Center', 'Fin. Surface',
  'HRS Combination', 'RM Width', 'PV-Desc',
];

const HRS_ROW = [
  'BN-H1', 46217, 'B', '1100038401', 'A', 'ACME', 'CRCA',
  536, 2.5, 3.2, 8.4, 1,
  'SP4RFXCLE', 'S', 'P', 'MATT',
  '483+483+536', 1500, 'HRS',
];

const PKL_HEADERS = [
  'Batch Number', 'Plan Date', 'Mother Coil', 'Slit ID', 'Customer Name', 'Grade',
  'Width', 'Pre Stage Thickness', 'Coil Weight', 'Count', 'Process Route',
  'From Work Center', 'To Work Center', 'Surface', 'First ANL TMP', 'PV-Desc',
];

const PKL_ROW = [
  'BN-P1', 46217, '1100038402', 'B', 'ACME', 'CRCA',
  400, 2.8, 10.1, 1, 'SP4F',
  'P', '4', 'HR-BLACK', 680, 'PICKL',
];

const ANN_HEADERS = [
  'Batch Number', 'Plan Date', 'Mother Coil', 'Slit ID', 'Customer Name', 'Grade',
  'Height', 'Width', 'Pre Stage Thickness', 'Coil Weight', 'Count', 'Process Route',
  'From Work Center', 'To Work Center', 'Ann Cycle', 'Charge No', 'First Annealing Temp',
];

const ANN_ROW = [
  'BN-A1', 46217, '1100038403', 'C', 'ACME', 'CRCA',
  473, '143.000*02+175.000*01', 1.2, 9.5, 1, 'SF',
  'F', 'X', 'C1', 'CH-9', 720,
];

describe('per-line plan sheets', () => {
  it('HRS parses Act. Process Route + Thinkness typo', () => {
    const result = parseHrsPlanXlsx(xlsxBuf(HRS_HEADERS, HRS_ROW), { shiftCode: 'A' });
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.errors).toEqual([]);
    expect(row.machineCode).toBe('HRS');
    expect(row.subProcess).toBe('HRS');
    expect(row.processRouteRaw).toBe('SP4RFXCLE');
    expect(row.processRouteCanonical.length).toBeGreaterThan(0);
    expect(row.inputThkMm).toBe(3.2);
    expect(row.finishThkMm).toBe(2.5);
    expect(row.widthMm).toBe(536);
    expect(row.rawExtras?.hrsCombination).toBe('483+483+536');
    expect(row.rawExtras?.hrsSlitNo).toBe(1);
    expect(row.rawExtras?.hrsSlitLabel).toBe('A');
  });

  it('PKL parses without finish thickness (ppc thk := input)', () => {
    const result = parsePklPlanXlsx(xlsxBuf(PKL_HEADERS, PKL_ROW), { shiftCode: 'B' });
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.errors).toEqual([]);
    expect(row.machineCode).toBe('PKL');
    expect(row.inputThkMm).toBe(2.8);
    expect(row.finishThkMm).toBe(2.8);
    expect(row.passTargetThkMm).toBe(2.8);
    expect(row.rawExtras?.firstAnlTmp).toBe(680);
  });

  it('ANN reads width from Height and keeps slit combo in rawExtras', () => {
    const result = parseAnnPlanXlsx(xlsxBuf(ANN_HEADERS, ANN_ROW), { shiftCode: 'C' });
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.errors).toEqual([]);
    expect(row.machineCode).toBe('ANN');
    expect(row.widthMm).toBe(473);
    expect(row.finishThkMm).toBe(1.2);
    expect(row.rawExtras?.slitCombination).toBe('143.000*02+175.000*01');
    expect(row.rawExtras?.chargeNo).toBe('CH-9');
  });

  it('ANN carries forward prior width when Height is zero and skips spacer rows', () => {
    const spacer = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', 'C-SPACER', '', ''];
    const annRow2 = [
      'BN-A2', 46218, '1100038404', 'D', 'ACME', 'CRCA',
      0, '99.000*01', 1.1, 8.8, 1, 'SF',
      'F', 'X', 'C2', 'CH-10', 710,
    ];
    const result = parseAnnPlanXlsx(xlsxBuf(ANN_HEADERS, [ANN_ROW, spacer, annRow2]), { shiftCode: 'C' });
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].widthMm).toBe(473);
    expect(result.rows[1].batchNumber).toBe('BN-A2');
    expect(result.rows[1].widthMm).toBe(473);
    expect(result.rows[1].errors).toEqual([]);
  });

  it('rejects wrong file by signature (cross-line)', () => {
    const hrsBuf = xlsxBuf(HRS_HEADERS, HRS_ROW);
    const pklBuf = xlsxBuf(PKL_HEADERS, PKL_ROW);
    const annBuf = xlsxBuf(ANN_HEADERS, ANN_ROW);

    expect(parseHrsPlanXlsx(pklBuf).headerError).toMatch(/doesn't look like a HRS plan/);
    expect(parseHrsPlanXlsx(annBuf).headerError).toMatch(/doesn't look like a HRS plan/);
    expect(parsePklPlanXlsx(hrsBuf).headerError).toMatch(/doesn't look like a PKL plan/);
    expect(parsePklPlanXlsx(annBuf).headerError).toMatch(/doesn't look like a PKL plan/);
    expect(parseAnnPlanXlsx(hrsBuf).headerError).toMatch(/doesn't look like a ANN plan/);
    expect(parseAnnPlanXlsx(pklBuf).headerError).toMatch(/doesn't look like a ANN plan/);
  });
});
