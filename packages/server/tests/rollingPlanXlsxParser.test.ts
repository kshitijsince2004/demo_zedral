import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  machineFromPvDesc,
  machineFromWorkCenter,
  parseRollingPlanXlsx,
  resolveMachineCode,
} from '../src/utils/rollingPlanXlsxParser';

const samplePath = path.resolve(__dirname, '../../../doc/ROLLLING PLAN.XLSX');
const skinPassPath = path.resolve(__dirname, '../../../doc/SKINPASS PLAN.XLSX');

describe('parseRollingPlanXlsx', () => {
  it('maps PV-Desc to machine codes', () => {
    expect(machineFromPvDesc('6HIML')).toBe('6HI');
    expect(machineFromPvDesc('4HIML')).toBe('4HI');
    expect(machineFromPvDesc('2HIML')).toBe('2HI');
  });

  it('maps skin-pass work-center codes to machine codes', () => {
    expect(machineFromWorkCenter('X')).toBe('2HI');
    expect(machineFromWorkCenter('Y')).toBe('4HI');
    expect(machineFromWorkCenter('Z')).toBe('6HI');
  });

  it('resolveMachineCode defaults to 6HI when PV-Desc and work center are absent', () => {
    expect(resolveMachineCode()).toBe('6HI');
    expect(resolveMachineCode('', '')).toBe('6HI');
    expect(resolveMachineCode('6HIML')).toBe('6HI');
    expect(resolveMachineCode('', 'Y')).toBe('4HI');
  });

  it('parses rolling rows without a PV-Desc column', () => {
    const XLSX = require('xlsx') as typeof import('xlsx');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Batch Number', 'Mother Coil', 'Customer Name', 'Grade', 'Finish Thickness', 'Pre Stage Thickness', 'Coil Weight', 'Width', 'Process Route', 'Plan Date', 'Count'],
      ['B-NOPV', 'COIL-NOPV-1', 'Hero Steels', 'CRCA', 0.5, 2.0, 12.5, 1000, 'SP4RFXCZ', '2026-06-08', 1],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Rolling');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const result = parseRollingPlanXlsx(buf, { sheetType: 'ROLLING', shiftCode: 'B' });
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].machineCode).toBe('6HI');
  });

  it('parses the pilot rolling plan workbook with per-row machines and plan dates', () => {
    if (!fs.existsSync(samplePath)) {
      return;
    }
    const buf = fs.readFileSync(samplePath);
    const result = parseRollingPlanXlsx(buf, { sheetType: 'ROLLING', shiftCode: 'B' });
    expect(result.headerError).toBeUndefined();
    expect(result.rows.length).toBeGreaterThan(0);
    const valid = result.rows.filter((r) => r.errors.length === 0);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid[0].batchNumber).toBeTruthy();
    expect(valid[0].gradeCode).toBeTruthy();
    expect(valid[0].processRouteCanonical).toBeTruthy();
    expect(['6HI', '4HI']).toContain(valid[0].machineCode);
    expect(valid[0].planDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const machines = new Set(valid.map((r) => r.machineCode));
    expect(machines.has('6HI')).toBe(true);
  });

  it('parses the pilot skin-pass workbook from From Work Center and SP columns', () => {
    if (!fs.existsSync(skinPassPath)) {
      return;
    }
    const buf = fs.readFileSync(skinPassPath);
    const result = parseRollingPlanXlsx(buf, { sheetType: 'SKIN_PASS', shiftCode: 'B' });
    expect(result.headerError).toBeUndefined();
    expect(result.rows.length).toBeGreaterThan(0);
    const valid = result.rows.filter((r) => r.errors.length === 0);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid[0].subProcess).toBe('SKIN_PASS');
    expect(valid[0].machineCode).toBe('2HI');
    expect(valid[0].passTargetThkMm).toBeGreaterThan(0);
    expect(valid[0].rollFinish).toBeTruthy();
    expect(valid[0].processRouteCanonical).toBeTruthy();
  });

  it('flags rows missing required fields', () => {
    const XLSX = require('xlsx') as typeof import('xlsx');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['PV-Desc', 'Batch Number', 'Mother Coil', 'Customer Name', 'Grade', 'Finish Thickness', 'Process Route', 'Plan Date'],
      ['6HIML', 'B001', '', 'ACME', '', 0.6, 'SP4RFXCZ', '2026-06-01'],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Rolling');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const result = parseRollingPlanXlsx(buf, { sheetType: 'ROLLING', shiftCode: 'A' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].machineCode).toBe('6HI');
    expect(result.rows[0].errors.some((e) => e.includes('coil'))).toBe(true);
    expect(result.rows[0].errors.some((e) => e.includes('grade'))).toBe(true);
  });
});
