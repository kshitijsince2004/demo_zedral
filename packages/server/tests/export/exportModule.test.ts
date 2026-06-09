import { describe, it, expect } from 'vitest';
import { parseExportRequest, parseQueryParams } from '../../src/export/jobs/ExportJobService';
import { renderCsv } from '../../src/export/render/CsvRenderer';
import fs from 'fs';

describe('export module phase 0', () => {
  it('parseExportRequest maps legacy body to RAW', () => {
    const req = parseExportRequest({
      scope: { processId: 'HRS', dateFrom: '2026-01-01' },
      format: 'csv',
    });
    expect(req.type).toBe('RAW');
    expect(req.format).toBe('CSV');
    expect(req.scope.processId).toBe('HRS');
  });

  it('parseExportRequest accepts new typed body', () => {
    const req = parseExportRequest({
      type: 'DPR',
      format: 'xlsx',
      scope: { month: '2026-05' },
    });
    expect(req.type).toBe('DPR');
    expect(req.format).toBe('XLSX');
  });

  it('parseQueryParams builds RAW request from GET query', () => {
    const req = parseQueryParams({ process: 'PKL', format: 'xlsx', date_from: '2026-06-01' });
    expect(req.type).toBe('RAW');
    expect(req.format).toBe('XLSX');
    expect(req.scope.processId).toBe('PKL');
    expect(req.scope.dateFrom).toBe('2026-06-01');
  });

  it('CsvRenderer writes artifact with sha256', async () => {
    const jobId = `test_${Date.now()}`;
    const rendered = await renderCsv(jobId, {
      rows: [{ coil_no: 'C1', weight_mt: 1.5 }],
      filename: 'test.csv',
    });
    expect(fs.existsSync(rendered.filePath)).toBe(true);
    expect(rendered.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(rendered.bytes).toBeGreaterThan(0);
    fs.unlinkSync(rendered.filePath);
  });
});
