import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { BLOCK_STRIDE, titleRow } from '../../dpr/geometry/blockGeometry';
import { dateString, dprFilename as legacyDprFilename } from '../../dpr/geometry/monthCalendar';
import type { DprAreaDayBlock, DprRdm, DelayLogEntry } from '../types/rdm';
import { areaRow, AREA_TITLE_OFFSET } from './areaGeometry';
import { zeroAllTemplateInputs, zeroDelaySheetInputs } from './blankDprWorkbook';

/** Excel column numbers for template INPUT cells (1-indexed). */
const COL = {
  target: 2,
  prodA: 3,
  prodB: 4,
  prodC: 5,
  electA: 26,
  electB: 27,
  electC: 28,
  mechA: 30,
  mechB: 31,
  mechC: 32,
  operA: 34,
  operB: 35,
  operC: 36,
  availA: 38,
  availB: 39,
  availC: 40,
  prevMaint: 42,
  powerA: 44,
  powerB: 45,
  powerC: 46,
  rmA: 54,
  rmB: 55,
  rmC: 56,
  scrapA: 62,
  scrapB: 66,
  scrapC: 70,
  rejA: 63,
  rejB: 67,
  rejC: 71,
  date: 13,
  dayNum: 60,
  despatch: 6,
} as const;

function assetPath(...parts: string[]): string {
  const candidates = [
    path.join(process.cwd(), ...parts),
    path.join(process.cwd(), 'packages', 'server', ...parts),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function blankMasterPath(): string {
  return assetPath('assets', 'dpr', 'dpr_blank_master.xlsx');
}

function resolveTemplatePath(): string {
  const blank = blankMasterPath();
  if (fs.existsSync(blank)) return blank;

  const legacy = assetPath('assets', 'dpr', 'dpr_master_template.xlsx');
  if (fs.existsSync(legacy)) return legacy;

  throw new Error(
    'DPR blank master not found. Run: node packages/server/scripts/build-dpr-blank-master.js',
  );
}

function setNum(ws: ExcelJS.Worksheet, row: number, col: number, value: number) {
  ws.getCell(row, col).value = value ?? 0;
}

function hasTxnActivity(area: DprAreaDayBlock): boolean {
  const s = area.stoppageMin;
  const stoppageTotal =
    s.electrical.total + s.mechanical.total + s.operational.total +
    s.equipment_availability.total + s.prev_maint + s.power_failure +
    s.no_plan + s.rm_shortage;
  return area.prod.total > 0 || area.scrap.total > 0 || area.internalRej.total > 0 || stoppageTotal > 0;
}

function writeAreaInputs(ws: ExcelJS.Worksheet, row: number, area: DprAreaDayBlock) {
  setNum(ws, row, COL.target, area.targetMt);
  if (!hasTxnActivity(area)) return;

  setNum(ws, row, COL.prodA, area.prod.A);
  setNum(ws, row, COL.prodB, area.prod.B);
  setNum(ws, row, COL.prodC, area.prod.C);
  setNum(ws, row, COL.electA, area.stoppageMin.electrical.A);
  setNum(ws, row, COL.electB, area.stoppageMin.electrical.B);
  setNum(ws, row, COL.electC, area.stoppageMin.electrical.C);
  setNum(ws, row, COL.mechA, area.stoppageMin.mechanical.A);
  setNum(ws, row, COL.mechB, area.stoppageMin.mechanical.B);
  setNum(ws, row, COL.mechC, area.stoppageMin.mechanical.C);
  setNum(ws, row, COL.operA, area.stoppageMin.operational.A);
  setNum(ws, row, COL.operB, area.stoppageMin.operational.B);
  setNum(ws, row, COL.operC, area.stoppageMin.operational.C);
  setNum(ws, row, COL.availA, area.equipAvailMin.A);
  setNum(ws, row, COL.availB, area.equipAvailMin.B);
  setNum(ws, row, COL.availC, area.equipAvailMin.C);
  setNum(ws, row, COL.prevMaint, area.stoppageMin.prev_maint);
  setNum(ws, row, COL.powerA, area.stoppageMin.power_failure);
  setNum(ws, row, COL.powerB, 0);
  setNum(ws, row, COL.powerC, 0);
  setNum(ws, row, COL.rmA, area.stoppageMin.rm_shortage);
  setNum(ws, row, COL.rmB, 0);
  setNum(ws, row, COL.rmC, 0);
  setNum(ws, row, COL.scrapA, area.scrap.A);
  setNum(ws, row, COL.scrapB, area.scrap.B);
  setNum(ws, row, COL.scrapC, area.scrap.C);
  setNum(ws, row, COL.rejA, area.internalRej.A);
  setNum(ws, row, COL.rejB, area.internalRej.B);
  setNum(ws, row, COL.rejC, area.internalRej.C);
}

function writeDayBlock(
  ws: ExcelJS.Worksheet,
  dayIndex: number,
  year: number,
  month: number,
  areas: DprAreaDayBlock[],
  rollups: DprRdm['days'][0]['rollups'],
  allowedAreas: Set<string> | null,
) {
  const base = titleRow(dayIndex);
  ws.getCell(base, COL.date).value = dateString(year, month, dayIndex);
  ws.getCell(base, COL.dayNum).value = dayIndex;

  for (const area of areas) {
    if (allowedAreas && !allowedAreas.has(area.areaCode)) continue;
    const row = areaRow(dayIndex, area.areaCode);
    writeAreaInputs(ws, row, area);
  }

  if (!allowedAreas) {
    const wipRow = base + AREA_TITLE_OFFSET.WIP;
    setNum(ws, wipRow, COL.despatch, rollups.despatchMt);
  }
}

function findDelayLineRows(ws: ExcelJS.Worksheet): number[] {
  const rows: number[] = [];
  ws.eachRow((row, rowNumber) => {
    const v = row.getCell(1).value;
    if (String(v ?? '').trim() === 'LINE') rows.push(rowNumber);
  });
  return rows;
}

const DELAY_LABEL_TO_AREA: Record<string, string> = {
  HRS: 'HRS',
  PKLG: 'PKLG',
  '4Hi(R)': '4HI_R',
  '4 Hi(R)': '4HI_R',
  '6Hi (R)': '6HI_R',
  '6 Hi (R)': '6HI_R',
  '2Hi (SP)': '2HI_SP',
  '2 Hi (SP)': '2HI_SP',
  'R/W LINE': 'RW_LINE',
  HPH: 'HPH',
  'CRS-1': 'CRS_1',
  'CRS-2': 'CRS_2',
  'CRS-3': 'CRS_3',
  'CRS-4': 'CRS_4',
  'CRS-5': 'CRS_5',
  'CRS-6': 'CRS_6',
  'CTL-1': 'CTL_1',
  'CTL-2': 'CTL_2',
  'CTL-3': 'CTL_3',
  'CTL-4': 'CTL_4',
  'CTL-5': 'CTL_5',
};

function injectDelaySheet(
  ws: ExcelJS.Worksheet,
  delayLog: DelayLogEntry[],
  allowedAreas: Set<string> | null,
) {
  zeroDelaySheetInputs(ws);

  const lineRows = findDelayLineRows(ws);
  const byKey = new Map<string, DelayLogEntry>();
  for (const entry of delayLog) {
    if (entry.isNil) continue;
    const areaCode = Object.entries(DELAY_LABEL_TO_AREA).find(
      ([label]) => label.toUpperCase() === entry.areaLabel.toUpperCase(),
    )?.[1] ?? entry.areaLabel;
    if (allowedAreas && !allowedAreas.has(areaCode)) continue;
    const key = `${entry.date}|${entry.shift}|${entry.areaLabel}`;
    byKey.set(key, entry);
  }

  for (let i = 0; i < lineRows.length; i++) {
    const headerRow = lineRows[i];
    const nextHeader = lineRows[i + 1] ?? ws.rowCount + 1;
    const headerDate = ws.getCell(headerRow, 2).value;
    const headerShift = String(ws.getCell(headerRow, 3).value ?? '').trim();

    for (let r = headerRow + 1; r < nextHeader; r++) {
      const label = String(ws.getCell(r, 1).value ?? '').trim();
      if (!label) continue;
      const dateStr = formatDelayDate(headerDate);
      const key = `${dateStr}|${headerShift}|${label}`;
      const altKey = `${dateStr}|${headerShift}|${DELAY_LABEL_TO_AREA[label] ?? label}`;
      const entry = byKey.get(key) ?? byKey.get(altKey);
      if (!entry) {
        ws.getCell(r, 4).value = 0;
        ws.getCell(r, 5).value = '';
        ws.getCell(r, 6).value = '';
        continue;
      }
      ws.getCell(r, 4).value = entry.minutes ?? 0;
      ws.getCell(r, 5).value = entry.agency ?? '';
      ws.getCell(r, 6).value = entry.reason ?? '';
    }
  }
}

function formatDelayDate(val: ExcelJS.CellValue): string {
  if (val == null) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val);
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

function trimTrailingBlocks(ws: ExcelJS.Worksheet, daysInMonth: number) {
  if (daysInMonth >= 31) return;
  const firstExtraRow = titleRow(daysInMonth + 1);
  const lastRow = ws.rowCount;
  if (firstExtraRow <= lastRow) {
    ws.spliceRows(firstExtraRow, lastRow - firstExtraRow + 1);
  }
}

function trimDelayBlocks(ws: ExcelJS.Worksheet, daysInMonth: number) {
  const lineRows = findDelayLineRows(ws);
  const keepBlocks = daysInMonth * 3;
  if (lineRows.length <= keepBlocks) return;
  const cutFrom = lineRows[keepBlocks];
  if (cutFrom != null) {
    ws.spliceRows(cutFrom, ws.rowCount - cutFrom + 1);
  }
}

function monthSheetLabel(year: number, month: number): string {
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${names[month - 1]} ${year}`.slice(0, 31);
}

export interface InjectOptions {
  allowedAreaCodes?: string[] | null;
}

/** Load blank master, zero all inputs, inject live RDM values only. */
export async function injectDprTemplate(
  rdm: DprRdm,
  options: InjectOptions = {},
): Promise<{ buffer: Buffer; filename: string; sheetName: string }> {
  const templatePath = resolveTemplatePath();
  const [yearStr, monthStr] = rdm.month.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const daysInMonth = rdm.days.length;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const mainSheet = workbook.worksheets[0];
  const delaySheet = workbook.getWorksheet('DELAY');
  if (!mainSheet || !delaySheet) {
    throw new Error('Template must contain main sheet and DELAY sheet');
  }

  zeroAllTemplateInputs(workbook);

  mainSheet.name = monthSheetLabel(year, month);

  const allowed = options.allowedAreaCodes
    ? new Set(options.allowedAreaCodes)
    : null;

  for (const day of rdm.days) {
    writeDayBlock(mainSheet, day.dayIndex, year, month, day.areas, day.rollups, allowed);
  }

  injectDelaySheet(delaySheet, rdm.delayLog, allowed);
  trimTrailingBlocks(mainSheet, daysInMonth);
  trimDelayBlocks(delaySheet, daysInMonth);

  for (let day = 1; day <= daysInMonth; day++) {
    const ds = dateString(year, month, day);
    const lineRows = findDelayLineRows(delaySheet);
    const blockIdx = (day - 1) * 3;
    for (let s = 0; s < 3 && blockIdx + s < lineRows.length; s++) {
      delaySheet.getCell(lineRows[blockIdx + s], 2).value = ds;
    }
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    filename: legacyDprFilename(year, month),
    sheetName: mainSheet.name,
  };
}

export { resolveTemplatePath, blankMasterPath, BLOCK_STRIDE, titleRow };
