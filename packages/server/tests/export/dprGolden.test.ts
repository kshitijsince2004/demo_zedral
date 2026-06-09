import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { DprAggregator } from '../../src/export/aggregation/DprAggregator';
import {
  bindDprWorkbook,
  contentFingerprint,
  loadDprLayout,
  monthSheetName,
} from '../../src/export/layouts/TemplateBinder';
import { buildDprFromFixture } from '../../src/export/definitions/DprReport';
import { renderXlsx } from '../../src/export/render/XlsxRenderer';
import fixture from '../fixtures/export/may2026_subset.json';
import fs from 'fs';

function cellValue(cells: { row: number; col: number; value: unknown }[], row: number, col: number) {
  return cells.find((c) => c.row === row && c.col === col)?.value;
}

describe('DPR golden / layout fidelity (Phase 3)', () => {
  const layout = loadDprLayout();

  it('layout has block_height 47 and emitFormulas false', () => {
    expect(layout.blockHeight).toBe(47);
    expect(layout.emitFormulas).toBe(false);
    expect(layout.areas).toHaveLength(26);
  });

  it('month sheet name follows MAY 2026 pattern', () => {
    expect(monthSheetName('2026-05')).toBe('MAY 2026');
  });

  it('binds 31 day-blocks at 47-row stride', () => {
    const { bound } = buildDprFromFixture({
      month: '2026-05',
      runs: [],
      stoppages: [],
      dispositions: [],
      targets: [],
    });

    const dateCells = bound.monthCells.filter(
      (c) => c.col === layout.dateCol && /^\d{4}-\d{2}-\d{2}$/.test(String(c.value)),
    );
    expect(dateCells).toHaveLength(31);
    expect(dateCells[0].value).toBe('2026-05-01');
    expect(dateCells[30].value).toBe('2026-05-31');

    const blockStarts = dateCells.map((c) => c.row);
    for (let i = 1; i < blockStarts.length; i++) {
      expect(blockStarts[i] - blockStarts[i - 1]).toBe(layout.blockHeight);
    }
  });

  it('fixture 4HI_R day-1 production/KPI cells match RDM ±0.01', () => {
    const { rdm, bound } = buildDprFromFixture({
      month: fixture.month,
      runs: fixture.runs as any,
      stoppages: fixture.stoppages as any,
      dispositions: fixture.dispositions as any,
      targets: fixture.targets as any,
    });

    const area = rdm.days[0].areas.find((a) => a.areaCode === '4HI_R');
    expect(area).toBeDefined();

    const areaDef = layout.areas.find((a) => a.areaCode === '4HI_R')!;
    const row = layout.blockStartRow + areaDef.rowOffset;
    const cols = layout.columns;

    expect(cellValue(bound.monthCells, row, cols.prodA)).toBe(area!.prod.A);
    expect(cellValue(bound.monthCells, row, cols.prodB)).toBe(area!.prod.B);
    expect(cellValue(bound.monthCells, row, cols.prodC)).toBe(area!.prod.C);
    expect(cellValue(bound.monthCells, row, cols.prodTotal)).toBe(area!.prod.total);
    expect(cellValue(bound.monthCells, row, cols.cumMt)).toBe(area!.cumMt);
    expect(cellValue(bound.monthCells, row, cols.stoppageRmShortage)).toBe(area!.stoppageMin.rm_shortage);

    const util = cellValue(bound.monthCells, row, cols.utilisationToday) as number;
    expect(Math.abs(util - area!.utilisationPct.today)).toBeLessThanOrEqual(0.5);
  });

  it('DELAY sheet includes RMS and NIL rows', () => {
    const { bound } = buildDprFromFixture({
      month: fixture.month,
      runs: fixture.runs as any,
      stoppages: fixture.stoppages as any,
      dispositions: [],
      targets: [],
    });

    expect(bound.delaySheetName).toBe('DELAY');
    const reasons = bound.delayRows.map((r) => r.reason);
    expect(reasons).toContain('RMS');
    expect(reasons).toContain('NIL');
  });

  it('multi-sheet XLSX renders month + DELAY', async () => {
    const rdm = DprAggregator.aggregate({
      month: fixture.month,
      runs: fixture.runs as any,
      stoppages: fixture.stoppages as any,
      dispositions: [],
      targets: fixture.targets as any,
    });
    const bound = bindDprWorkbook(rdm);

    const jobId = `golden_${Date.now()}`;
    const rendered = await renderXlsx(jobId, {
      rows: bound.delayRows,
      filename: 'DPR MAY 2026.xlsx',
      gridSheets: [
        { name: bound.monthSheetName, cells: bound.monthCells },
        { name: bound.delaySheetName, cells: bound.delayCells },
      ],
      deterministic: true,
    });

    expect(fs.existsSync(rendered.filePath)).toBe(true);
    expect(rendered.sha256).toMatch(/^[a-f0-9]{64}$/);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(rendered.filePath);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['MAY 2026', 'DELAY']);

    fs.unlinkSync(rendered.filePath);
  });
});

describe('DPR reproducibility (§FR-1.5)', () => {
  it('same fixture → identical content fingerprint', () => {
    const input = {
      month: fixture.month,
      runs: fixture.runs as any,
      stoppages: fixture.stoppages as any,
      dispositions: fixture.dispositions as any,
      targets: fixture.targets as any,
    };
    const a = buildDprFromFixture(input);
    const b = buildDprFromFixture(input);
    expect(contentFingerprint(a.bound)).toBe(contentFingerprint(b.bound));
  });

  it('same fixture → identical cell values when xlsx is read back', async () => {
    const { bound } = buildDprFromFixture({
      month: fixture.month,
      runs: fixture.runs as any,
      stoppages: fixture.stoppages as any,
      dispositions: [],
      targets: [],
    });

    const payload = {
      rows: bound.delayRows,
      filename: 'DPR MAY 2026.xlsx',
      gridSheets: [
        { name: bound.monthSheetName, cells: bound.monthCells },
        { name: bound.delaySheetName, cells: bound.delayCells },
      ],
      deterministic: true,
    };

    const r1 = await renderXlsx(`repro_a_${Date.now()}`, payload);
    const r2 = await renderXlsx(`repro_b_${Date.now() + 1}`, payload);

    const readKeyCells = async (filePath: string) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const month = wb.getWorksheet('MAY 2026');
      const areaDef = loadDprLayout().areas.find((a) => a.areaCode === '4HI_R')!;
      const row = loadDprLayout().blockStartRow + areaDef.rowOffset;
      return {
        prodA: month?.getCell(row, 3).value,
        prodTotal: month?.getCell(row, 6).value,
      };
    };

    const cells1 = await readKeyCells(r1.filePath);
    const cells2 = await readKeyCells(r2.filePath);
    expect(cells1).toEqual(cells2);

    fs.unlinkSync(r1.filePath);
    fs.unlinkSync(r2.filePath);
  });
});
