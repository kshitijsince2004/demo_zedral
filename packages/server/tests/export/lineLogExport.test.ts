import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import fs from 'fs';
import {
  dbProcessCode,
  listLineLogProcesses,
  loadLineLogLayout,
  mandatoryBodyFields,
} from '../../src/export/layouts/line_log';
import { bindLineLogWorkbook } from '../../src/export/layouts/LineLogBinder';
import { LineLogReport } from '../../src/export/definitions/LineLogReport';
import { parseLineLogScope } from '../../src/export/read/lineLogQuery';
import { renderPdf } from '../../src/export/render/PdfRenderer';
import { renderXlsx } from '../../src/export/render/XlsxRenderer';
import type { LineLogRdm } from '../../src/export/layouts/line_log/types';

const DOC_NUMBERS: Record<string, string> = {
  HRS: 'PQR/PRD/0901/03',
  PKL: 'PQR/PRD/0902/01',
  CRM: 'PQR/PRD/0903/02',
  ANN: 'PQR/PRD/0904/01',
  SKP: 'PQR/PRD/0905/01',
  RWD: 'PQR/PRD/0906/01',
  CRS: 'FOI/PRD/1302/00',
  CTL: 'FOI/PRD/1303/00',
};

const mockUser = {
  id: 1,
  roles: ['ADMIN'],
  lineAccess: [],
  lineScopes: [],
} as any;

function sampleRdm(processCode: string): LineLogRdm {
  const layout = loadLineLogLayout(processCode);
  const mandatory = mandatoryBodyFields(layout);
  const bodyRow: Record<string, string | number | null> = { sl_no: 1 };
  for (const field of mandatory) {
    if (field === 'coil_no') bodyRow.coil_no = 'C-TEST-001';
    else if (field.includes('weight') || field.includes('mt')) bodyRow[field] = 12.5;
    else if (field.includes('thk') || field.includes('width')) bodyRow[field] = 1.2;
    else bodyRow[field] = 'OK';
  }

  return {
    report: 'LINE_LOG',
    processCode,
    documentNumber: layout.documentNumber,
    title: layout.title,
    dateFrom: '2026-05-01',
    dateTo: '2026-05-01',
    generatedAt: '2026-05-01T12:00:00.000Z',
    shifts: [
      {
        shiftLogId: '1',
        prodDate: '2026-05-01',
        shiftCode: 'A',
        bodyRows: [bodyRow],
        stoppages: [{ stoppage_code: 'EL01', time_from: '08:00', time_to: '08:15', duration_min: 15, remarks: 'test' }],
        crew: [{ operator_name: 'Operator A', role_code: 'OP' }],
        defects: [],
      },
    ],
  };
}

vi.mock('../../src/export/read/lineLogQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/export/read/lineLogQuery')>();
  return {
    ...actual,
    fetchLineLogRdm: vi.fn(async (scope: Record<string, unknown>) => {
      const parsed = actual.parseLineLogScope(scope);
      return sampleRdm(parsed.processCode);
    }),
  };
});

describe('line log export (Phase 5)', () => {
  it('lists eight process templates', () => {
    expect(listLineLogProcesses()).toHaveLength(8);
    expect(listLineLogProcesses()).toEqual(['HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL']);
  });

  it.each(listLineLogProcesses())('layout %s has correct document number and mandatory body fields', (code) => {
    const layout = loadLineLogLayout(code);
    expect(layout.documentNumber).toBe(DOC_NUMBERS[code]);
    expect(layout.body.columns.length).toBeGreaterThan(0);
    const mandatory = mandatoryBodyFields(layout);
    expect(mandatory.length).toBeGreaterThan(0);
    mandatory.forEach((field) => {
      expect(layout.body.columns.some((c) => c.field === field && c.mandatory)).toBe(true);
    });
  });

  it('CRM layout maps to 6HI in DB', () => {
    expect(dbProcessCode('CRM')).toBe('6HI');
    expect(dbProcessCode('HRS')).toBe('HRS');
  });

  it('parseLineLogScope accepts snake_case and camelCase', () => {
    const scope = parseLineLogScope({
      process_code: 'CRS',
      date_from: '2026-05-01',
      date_to: '2026-05-02',
      shift: 'B',
    });
    expect(scope.processCode).toBe('CRS');
    expect(scope.shiftCode).toBe('B');
  });

  it('bindLineLogWorkbook emits document number and mandatory column headers', () => {
    const rdm = sampleRdm('HRS');
    const bound = bindLineLogWorkbook(rdm);
    expect(bound.sheets).toHaveLength(1);
    const docCell = bound.sheets[0].cells.find((c) => String(c.value).includes('PQR/PRD/0901/03'));
    expect(docCell).toBeDefined();
    const layout = loadLineLogLayout('HRS');
    for (const col of layout.body.columns.filter((c) => c.mandatory)) {
      expect(bound.sheets[0].cells.some((c) => c.value === col.header)).toBe(true);
    }
  });

  it('HTML output includes watermark and sign-off roles', () => {
    const bound = bindLineLogWorkbook(sampleRdm('CTL'));
    expect(bound.html).toContain('Generated from M1 on');
    expect(bound.html).toContain('FOI/PRD/1303/00');
    expect(bound.html).toContain('Line Incharge');
    expect(bound.html).toContain('Shift Manager');
  });

  it('LineLogReport execute XLSX produces grid sheets', async () => {
    const result = await LineLogReport.execute(
      { process_code: 'CRS', date_from: '2026-05-01', date_to: '2026-05-01' },
      'XLSX',
      mockUser,
    );
    expect(result.gridSheets?.length).toBe(1);
    expect(result.filename).toMatch(/line_log_CRS_.*\.xlsx$/);
    expect(result.dataVersion).toContain('FOI/PRD/1302/00');

    const jobId = `ll_xlsx_${Date.now()}`;
    const rendered = await renderXlsx(jobId, { ...result, deterministic: true });
    expect(fs.existsSync(rendered.filePath)).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(rendered.filePath);
    expect(wb.worksheets.length).toBeGreaterThan(0);
    fs.unlinkSync(rendered.filePath);
  });

  it('LineLogReport execute PDF provides HTML for renderer', async () => {
    const result = await LineLogReport.execute(
      { process_code: 'HRS', date_from: '2026-05-01', date_to: '2026-05-01' },
      'PDF',
      mockUser,
    );
    expect(result.html).toBeTruthy();
    // ponytail: skip puppeteer renderPdf here — hangs without Chromium; HTML is the unit contract
  });
});
