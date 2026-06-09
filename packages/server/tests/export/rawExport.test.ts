import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import fs from 'fs';
import {
  projectRow,
  resolveColumns,
  dictionaryRows,
  DEFAULT_REGISTER_COLUMNS,
} from '../../src/export/definitions/registerDictionary';
import { parseRawScope } from '../../src/export/read/rawRegisterQuery';
import { RawRegisterReport } from '../../src/export/definitions/RawRegisterReport';
import { renderCsv } from '../../src/export/render/CsvRenderer';
import { renderXlsx } from '../../src/export/render/XlsxRenderer';
import { contentFingerprint } from '../../src/export/layouts/TemplateBinder';

const mockUser = {
  id: 1,
  roles: ['ADMIN'],
  lineAccess: [],
  lineScopes: [],
} as any;

vi.mock('../../src/export/read/rawRegisterQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/export/read/rawRegisterQuery')>();
  return {
    ...actual,
    fetchRawRegisterRows: vi.fn(async () => ({
      rows: [
        {
          process_code: 'HRS',
          area_code: 'HRS',
          coil_no: 'C-100',
          prod_date: '2026-05-01',
          shift_code: 'A',
          output_weight_mt: 10,
          status: 'OK',
          source_table: 'txn.prod_hrs',
          source_entry_id: '1',
        },
        {
          process_code: 'PKL',
          area_code: 'PKLG',
          coil_no: 'C-100',
          prod_date: '2026-05-01',
          shift_code: 'B',
          output_weight_mt: 9.5,
          status: 'OK',
          source_table: 'txn.prod_pkl',
          source_entry_id: '2',
        },
      ],
      parsed: { dateFrom: '2026-05-01', dateTo: '2026-05-01' },
      lines: ['HRS', 'PKL'],
    })),
    countRawRegisterRows: vi.fn(async () => 2),
    iterateRawRegisterBatches: vi.fn(async function* () {
      yield [
        {
          process_code: 'HRS',
          area_code: 'HRS',
          coil_no: 'C-100',
          prod_date: '2026-05-01',
          shift_code: 'A',
          output_weight_mt: 10,
          status: 'OK',
          source_table: 'txn.prod_hrs',
          source_entry_id: '1',
        },
      ];
      yield [
        {
          process_code: 'PKL',
          area_code: 'PKLG',
          coil_no: 'C-100',
          prod_date: '2026-05-01',
          shift_code: 'B',
          output_weight_mt: 9.5,
          status: 'OK',
          source_table: 'txn.prod_pkl',
          source_entry_id: '2',
        },
      ];
    }),
  };
});

describe('raw register export (Phase 4)', () => {
  it('parseRawScope accepts array and legacy filters', () => {
    const parsed = parseRawScope({
      date_from: '2026-01-01',
      date_to: '2026-01-31',
      process_code: 'HRS,PKL',
      coil_no: 'C-1,C-2',
      shift_code: 'A',
      customer_code: 'CUST_TATA',
      status: 'OK,HOLD',
      columns: 'coil_no,process_code',
    });
    expect(parsed.dateFrom).toBe('2026-01-01');
    expect(parsed.processCodes).toEqual(['HRS', 'PKL']);
    expect(parsed.coilNos).toEqual(['C-1', 'C-2']);
    expect(parsed.customerCodes).toEqual(['CUST_TATA']);
    expect(parsed.statuses).toEqual(['OK', 'HOLD']);
    expect(parsed.columns).toEqual(['coil_no', 'process_code']);
  });

  it('resolveColumns defaults to canonical register set', () => {
    expect(resolveColumns()).toEqual(DEFAULT_REGISTER_COLUMNS);
    expect(resolveColumns(['coil_no', 'bad'])).toEqual(['coil_no']);
  });

  it('RAW CSV execute uses streaming batches', async () => {
    const result = await RawRegisterReport.execute(
      { dateFrom: '2026-05-01', dateTo: '2026-05-01', processId: 'HRS' },
      'CSV',
      mockUser,
    );
    expect(result.streamBatches).toBeDefined();
    expect(result.rowCount).toBe(2);

    const jobId = `raw_csv_${Date.now()}`;
    const rendered = await renderCsv(jobId, result);
    expect(fs.existsSync(rendered.filePath)).toBe(true);
    const text = fs.readFileSync(rendered.filePath, 'utf8');
    const lines = text.trim().split('\n');
    expect(lines[0]).toContain('process_code');
    expect(lines.length).toBe(3);
    fs.unlinkSync(rendered.filePath);
  });

  it('RAW XLSX includes data_dictionary sheet', async () => {
    const result = await RawRegisterReport.execute(
      { dateFrom: '2026-05-01', dateTo: '2026-05-01' },
      'XLSX',
      mockUser,
    );
    expect(result.sheets?.map((s) => s.name)).toEqual(['data', 'data_dictionary']);
    expect(result.sheets![1].rows.length).toBe(dictionaryRows().length);

    const jobId = `raw_xlsx_${Date.now()}`;
    const rendered = await renderXlsx(jobId, { ...result, deterministic: true });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(rendered.filePath);
    expect(wb.worksheets.map((s) => s.name)).toContain('data_dictionary');
    fs.unlinkSync(rendered.filePath);
  });

  it('projectRow is reproducible for identical input', () => {
    const row = { coil_no: 'C-1', process_code: 'HRS', area_code: 'HRS' };
    const a = projectRow(row, ['coil_no', 'process_code']);
    const b = projectRow(row, ['coil_no', 'process_code']);
    expect(contentFingerprint({
      monthSheetName: '',
      monthCells: [],
      delaySheetName: '',
      delayCells: Object.entries(a).map(([k, v], i) => ({ row: i, col: 1, value: `${k}=${v}` })),
      delayRows: [],
    })).toBe(contentFingerprint({
      monthSheetName: '',
      monthCells: [],
      delaySheetName: '',
      delayCells: Object.entries(b).map(([k, v], i) => ({ row: i, col: 1, value: `${k}=${v}` })),
      delayRows: [],
    }));
  });
});
