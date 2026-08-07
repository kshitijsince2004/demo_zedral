import { describe, it, expect } from 'vitest';
import { buildDprFromFixture } from '../../src/export/definitions/DprReport';
import { injectDprTemplate, resolveTemplatePath, blankMasterPath } from '../../src/export/dpr/DprTemplateInjector';
import { MACHINE_INPUT_COLS } from '../../src/export/dpr/blankDprWorkbook';
import fs from 'fs';
import fixture from '../fixtures/export/may2026_subset.json';

describe('DPR template injection', () => {
  it('resolves blank master template from assets', () => {
    expect(fs.existsSync(blankMasterPath())).toBe(true);
    expect(resolveTemplatePath()).toContain('dpr_blank_master.xlsx');
  });

  it('exports zero-only inputs when no platform records exist', async () => {
    const { rdm } = buildDprFromFixture({
      month: '2026-06',
      runs: [],
      stoppages: [],
      dispositions: [],
      targets: [],
    });

    const { buffer } = await injectDprTemplate(rdm);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const main = wb.worksheets[0];
    const delay = wb.getWorksheet('DELAY')!;

    for (const col of MACHINE_INPUT_COLS) {
      expect(main.getCell(6, col).value ?? 0).toBe(0);
      expect(main.getCell(8, col).value ?? 0).toBe(0);
    }

    const delayData = delay.getCell(2, 4).value;
    expect(delayData === 0 || delayData === null || delayData === '').toBe(true);
  }, 60_000);
  it('injects fixture data into template preserving workbook structure', async () => {
    const { rdm } = buildDprFromFixture({
      month: fixture.month,
      runs: fixture.runs as any,
      stoppages: fixture.stoppages as any,
      dispositions: fixture.dispositions as any,
      targets: fixture.targets as any,
    });

    const { buffer, filename } = await injectDprTemplate(rdm);
    expect(buffer.length).toBeGreaterThan(10000);
    expect(filename).toMatch(/^DPR May 2026\.xlsx$/);

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(2);
    expect(wb.getWorksheet('DELAY')).toBeDefined();

    const main = wb.worksheets[0];
    const hrsRow = 6;
    const area = rdm.days[0].areas.find((a) => a.areaCode === 'HRS');
    expect(area).toBeDefined();
    expect(main.getCell(hrsRow, 3).value).toBe(area!.prod.A);
  });

  it('scopes injection to allowed area codes', async () => {
    const { rdm } = buildDprFromFixture({
      month: '2026-05',
      runs: [],
      stoppages: [],
      dispositions: [],
      targets: [],
    });

    const { buffer } = await injectDprTemplate(rdm, { allowedAreaCodes: ['HRS'] });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const main = wb.worksheets[0];

    expect(main.getCell(6, 3).value).toBe(0);
    expect(main.getCell(7, 3).value).toBe(0);
  });
});
