import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { DprAreaDayBlock, DprRdm, DelayLogEntry } from '../types/rdm';
import type { BoundWorkbook, DprLayoutV1, RenderCell } from './types';

let cachedLayout: DprLayoutV1 | null = null;

function resolveLayoutPath(): string {
  const candidates = [
    path.join(__dirname, 'dpr_layout.v1.json'),
    path.join(process.cwd(), 'src', 'export', 'layouts', 'dpr_layout.v1.json'),
    path.join(process.cwd(), 'dist', 'export', 'layouts', 'dpr_layout.v1.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('dpr_layout.v1.json not found');
}

export function loadDprLayout(): DprLayoutV1 {
  if (!cachedLayout) {
    cachedLayout = JSON.parse(fs.readFileSync(resolveLayoutPath(), 'utf8')) as DprLayoutV1;
  }
  return cachedLayout;
}

export function monthSheetName(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const layout = loadDprLayout();
  return layout.monthSheetNamePattern
    .replace('{MONTH}', names[m - 1] ?? 'MONTH')
    .replace('{MONTH_UPPER}', names[m - 1] ?? 'MONTH')
    .replace('{YEAR}', String(year));
}

export function dprFilename(month: string): string {
  return `DPR ${monthSheetName(month)}.xlsx`;
}

/** Maps DPR RDM → cell grid per layout config. */
export function bindDprWorkbook(rdm: DprRdm, layout: DprLayoutV1 = loadDprLayout()): BoundWorkbook {
  const monthCells: RenderCell[] = [];
  const sheetName = monthSheetName(rdm.month);

  for (const day of rdm.days) {
    const blockRow = layout.blockStartRow + (day.dayIndex - 1) * layout.blockHeight;
    const dateRow = blockRow + layout.dateRowOffset;

    monthCells.push({ row: dateRow, col: layout.dateCol, value: day.date });

    const areaByCode = new Map(day.areas.map((a) => [a.areaCode, a]));
    for (const areaDef of layout.areas) {
      const area = areaByCode.get(areaDef.areaCode);
      if (!area) continue;
      const row = blockRow + areaDef.rowOffset;
      monthCells.push(...bindAreaRow(row, area, layout));
    }

    monthCells.push(...bindRollupRows(blockRow, day.rollups, layout));
  }

  const { delayCells, delayRows } = bindDelaySheet(rdm.delayLog, layout);

  return {
    monthSheetName: sheetName,
    monthCells,
    delaySheetName: layout.delaySheet.name,
    delayCells,
    delayRows,
  };
}

function bindAreaRow(row: number, area: DprAreaDayBlock, layout: DprLayoutV1): RenderCell[] {
  const c = layout.columns;
  const cells: RenderCell[] = [
    cell(row, c.areaLabel, area.areaLabel),
    cell(row, c.targetMt, area.targetMt),
    cell(row, c.prodA, area.prod.A),
    cell(row, c.prodB, area.prod.B),
    cell(row, c.prodC, area.prod.C),
    cell(row, c.prodTotal, area.prod.total),
    cell(row, c.cumMt, area.cumMt),
    cell(row, c.avgMt, area.avgMt),
    cell(row, c.stoppageElectA, area.stoppageMin.electrical.A),
    cell(row, c.stoppageElectB, area.stoppageMin.electrical.B),
    cell(row, c.stoppageElectC, area.stoppageMin.electrical.C),
    cell(row, c.stoppageMechA, area.stoppageMin.mechanical.A),
    cell(row, c.stoppageMechB, area.stoppageMin.mechanical.B),
    cell(row, c.stoppageMechC, area.stoppageMin.mechanical.C),
    cell(row, c.stoppageOperA, area.stoppageMin.operational.A),
    cell(row, c.stoppageOperB, area.stoppageMin.operational.B),
    cell(row, c.stoppageOperC, area.stoppageMin.operational.C),
    cell(row, c.utilisationToday, area.utilisationPct.today),
    cell(row, c.utilisationCum, area.utilisationPct.cum),
    cell(row, c.prodRateA, area.prodRate.A),
    cell(row, c.prodRateB, area.prodRate.B),
    cell(row, c.prodRateC, area.prodRate.C),
    cell(row, c.prodRateToday, area.prodRate.today),
    cell(row, c.prodRateCum, area.prodRate.cum),
    cell(row, c.prodRateTarget, area.prodRate.target),
    cell(row, c.stoppageElectTotal, area.stoppageMin.electrical.total),
    cell(row, c.stoppageMechTotal, area.stoppageMin.mechanical.total),
    cell(row, c.stoppageOperTotal, area.stoppageMin.operational.total),
    cell(row, c.stoppageEquipA, area.stoppageMin.equipment_availability.A),
    cell(row, c.stoppageEquipB, area.stoppageMin.equipment_availability.B),
    cell(row, c.stoppageEquipC, area.stoppageMin.equipment_availability.C),
    cell(row, c.stoppagePrevMaint, area.stoppageMin.prev_maint),
    cell(row, c.stoppagePower, area.stoppageMin.power_failure),
    cell(row, c.stoppageNoPlan, area.stoppageMin.no_plan),
    cell(row, c.stoppageRmShortage, area.stoppageMin.rm_shortage),
    cell(row, c.equipAvailA, area.equipAvailMin.A),
    cell(row, c.equipAvailB, area.equipAvailMin.B),
    cell(row, c.equipAvailC, area.equipAvailMin.C),
    cell(row, c.equipAvailCum, area.equipAvailMin.cum),
    cell(row, c.scrapA, area.scrap.A),
    cell(row, c.scrapB, area.scrap.B),
    cell(row, c.scrapC, area.scrap.C),
    cell(row, c.scrapTotal, area.scrap.total),
    cell(row, c.scrapCum, area.scrap.cum),
    cell(row, c.scrapPct, area.scrap.pct),
    cell(row, c.rejA, area.internalRej.A),
    cell(row, c.rejB, area.internalRej.B),
    cell(row, c.rejC, area.internalRej.C),
    cell(row, c.rejTotal, area.internalRej.total),
    cell(row, c.rejCum, area.internalRej.cum),
    cell(row, c.rejPct, area.internalRej.pct),
    cell(row, c.bSlitTotal, area.bSlit.total),
    cell(row, c.trimTotal, area.trim.total),
  ];
  return cells;
}

function bindRollupRows(
  blockRow: number,
  rollups: DprRdm['days'][0]['rollups'],
  layout: DprLayoutV1,
): RenderCell[] {
  const r = layout.rollupRows;
  return [
    cell(blockRow + r.despatchMt, 2, rollups.despatchMt),
    cell(blockRow + r.yieldPct, 2, rollups.yieldPct),
    cell(blockRow + r.wr4hiNos, 2, rollups.wrChange['4hi'].nos),
    cell(blockRow + r.wr4hiMin, 2, rollups.wrChange['4hi'].min),
    cell(blockRow + r.wr6hiNos, 2, rollups.wrChange['6hi'].nos),
    cell(blockRow + r.wr6hiMin, 2, rollups.wrChange['6hi'].min),
    cell(blockRow + r.wr2hiNos, 2, rollups.wrChange['2hi'].nos),
    cell(blockRow + r.wr2hiMin, 2, rollups.wrChange['2hi'].min),
    cell(blockRow + r.fgBalanceMt, 2, rollups.fgBalanceMt),
  ];
}

function bindDelaySheet(
  delayLog: DelayLogEntry[],
  layout: DprLayoutV1,
): { delayCells: RenderCell[]; delayRows: Record<string, unknown>[] } {
  const ds = layout.delaySheet;
  const delayCells: RenderCell[] = [
    cell(ds.headerRow, ds.cols.line, 'LINE'),
    cell(ds.headerRow, ds.cols.date, 'DATE'),
    cell(ds.headerRow, ds.cols.shift, 'SHIFT'),
    cell(ds.headerRow, ds.cols.minutes, 'TIME IN MIN'),
    cell(ds.headerRow, ds.cols.agency, 'AGENCY'),
    cell(ds.headerRow, ds.cols.reason, 'REASON'),
  ];

  const delayRows: Record<string, unknown>[] = [];
  let row = ds.dataStartRow;

  for (const entry of delayLog) {
    delayCells.push(
      cell(row, ds.cols.line, entry.areaLabel),
      cell(row, ds.cols.date, entry.date),
      cell(row, ds.cols.shift, entry.shift),
      cell(row, ds.cols.minutes, entry.minutes ?? 'NIL'),
      cell(row, ds.cols.agency, entry.agency),
      cell(row, ds.cols.reason, entry.reason),
    );
    delayRows.push({
      line: entry.areaLabel,
      date: entry.date,
      shift: entry.shift,
      minutes: entry.minutes,
      agency: entry.agency,
      reason: entry.reason,
    });
    row += 1;
  }

  return { delayCells, delayRows };
}

function cell(row: number, col: number, value: string | number | null): RenderCell {
  return { row, col, value };
}

/** Stable hash input for reproducibility tests (sorted cell values). */
export function contentFingerprint(bound: BoundWorkbook): string {
  const payload = [
    ...bound.monthCells.map((c) => `${c.row}:${c.col}=${c.value}`),
    ...bound.delayCells.map((c) => `${c.row}:${c.col}=${c.value}`),
  ].sort().join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}
