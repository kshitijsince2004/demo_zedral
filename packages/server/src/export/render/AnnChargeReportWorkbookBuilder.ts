import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

export type AnnChargeReportWorkbookInput = {
  companyName: string;
  reportTitle: string;
  reportDate: string;
  generatedAt: string;
  generatedBy: string;
  scope: {
    baseNo: string;
    annealingBatchNo: string;
    chargeNo: string;
  };
  summary: {
    status: string;
    cycleDurationMin: number | null;
    completionPct: number | null;
    coilCount: number | null;
    gradeCode: string | null;
    weightMt: number | null;
    peakChargeTemp: number | null;
    avgChargeTemp: number | null;
    latestPressure: number | null;
    latestFlow: number | null;
    alarmOpenCount: number | null;
    startTime: string | null;
    endTime: string | null;
  };
  chartsDataRows: Array<{
    takenAt: string;
    stageCode: string | null;
    chargeTemp: number | null;
    gasTemp: number | null;
    fcTemp: number | null;
    basePress: number | null;
    baseFanRpm: number | null;
    n2h2Flow: number | null;
    fuelFlow: number | null;
    rcfRpm: number | null;
  }>;
  productionTableRows: Array<{
    timestamp: string;
    parameter: string;
    currentValue: number | null;
    min: number | null;
    max: number | null;
    avg: number | null;
    status: string;
    remarks: string;
  }>;
};

const BANNER = '103028';
const GROUP = '1F3864';
const WHITE = 'FFFFFF';
const ROW_ALT = 'E8F0FE';

const METRIC_COLS = {
  TIMESTAMP: 1,
  PARAMETER: 2,
  CURRENT: 3,
  MIN: 4,
  MAX: 5,
  AVG: 6,
  STATUS: 7,
  REMARKS: 8,
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

function fillSolid(hex: string) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } } as ExcelJS.Fill;
}

function headerFill(ws: ExcelJS.Worksheet, row: number, fromCol: number, toCol: number) {
  for (let c = fromCol; c <= toCol; c++) {
    const cell = ws.getCell(row, c);
    cell.fill = fillSolid(GROUP);
    cell.font = { bold: true, size: 10, color: { argb: `FF${WHITE}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: `FF${GROUP}` } },
      left: { style: 'thin', color: { argb: `FF${GROUP}` } },
      bottom: { style: 'thin', color: { argb: `FF${GROUP}` } },
      right: { style: 'thin', color: { argb: `FF${GROUP}` } },
    };
  }
}

function thinBorder(ws: ExcelJS.Worksheet, row: number, fromCol: number, toCol: number) {
  for (let c = fromCol; c <= toCol; c++) {
    ws.getCell(row, c).border = {
      top: { style: 'thin', color: { argb: 'FF9AA4B2' } },
      left: { style: 'thin', color: { argb: 'FF9AA4B2' } },
      bottom: { style: 'thin', color: { argb: 'FF9AA4B2' } },
      right: { style: 'thin', color: { argb: 'FF9AA4B2' } },
    };
  }
}

function autoSize(ws: ExcelJS.Worksheet, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const col = ws.getColumn(c);
    let maxLen = 10;
    const totalRows = ws.rowCount ?? 0;
    for (let rowIndex = 1; rowIndex <= totalRows; rowIndex++) {
      const row = ws.getRow(rowIndex);
      const cell = row.getCell(c);
      const v = cell?.value;
      if (v == null) continue;
      const s = typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : String(v);
      maxLen = Math.max(maxLen, s.length);
    }
    col.width = Math.min(40, Math.max(10, maxLen + 2));
  }
}

export async function buildAnnChargeReportWorkbook(input: AnnChargeReportWorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'M1 Export Module';
  workbook.created = new Date(input.generatedAt);
  workbook.modified = new Date(input.generatedAt);

  const logoPath = assetPath('assets', 'export', 'zedral_logo_white.png');
  const logoId = workbook.addImage({
    buffer: fs.readFileSync(logoPath) as unknown as ExcelJS.Buffer,
    extension: 'png',
  });

  // ---------------- Summary ----------------
  {
    const ws = workbook.addWorksheet('Summary');
    const lastCol = 4;
    ws.mergeCells(1, 1, 1, lastCol);
    const bannerCell = ws.getCell(1, 1);
    bannerCell.value = input.reportTitle;
    bannerCell.font = { bold: true, size: 15, color: { argb: `FF${WHITE}` } };
    bannerCell.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 26;
    for (let c = 1; c <= lastCol; c++) ws.getCell(1, c).fill = fillSolid(BANNER);
    ws.addImage(logoId, {
      tl: { col: lastCol - 1, row: 0 },
      ext: { width: 95, height: 28 },
    });

    // Freeze not needed for summary sheet; keep simple layout.
    ws.getCell(2, 1).value = 'Company';
    ws.getCell(2, 2).value = input.companyName;
    ws.getCell(3, 1).value = 'Report Date';
    ws.getCell(3, 2).value = input.reportDate;
    ws.getCell(4, 1).value = 'Selected Charge';
    ws.getCell(4, 2).value = input.scope.chargeNo;
    ws.getCell(5, 1).value = 'Base / Batch';
    ws.getCell(5, 2).value = `${input.scope.baseNo} / ${input.scope.annealingBatchNo}`;
    ws.getCell(6, 1).value = 'Generated By';
    ws.getCell(6, 2).value = input.generatedBy;
    ws.getCell(7, 1).value = 'Generated At';
    ws.getCell(7, 2).value = input.generatedAt;

    // KPI table header
    const headerRow = 9;
    ws.getCell(headerRow, 1).value = 'Metric';
    ws.getCell(headerRow, 2).value = 'Value';
    headerFill(ws, headerRow, 1, 2);
    ws.mergeCells(headerRow + 1, 1, headerRow + 1, 2);

    const s = input.summary;
    const rows: Array<[string, string]> = [
      ['Status', s.status ?? '—'],
      ['Cycle Duration', s.cycleDurationMin != null ? `${s.cycleDurationMin.toFixed(1)} min` : '—'],
      ['Completion %', s.completionPct != null ? `${s.completionPct}%` : '—'],
      ['Start Time', s.startTime ?? '—'],
      ['End Time', s.endTime ?? '—'],
      ['Coil Count', s.coilCount != null ? String(s.coilCount) : '—'],
      ['Grade', s.gradeCode ?? '—'],
      ['Weight (MT)', s.weightMt != null ? `${s.weightMt.toFixed(2)}` : '—'],
      ['Peak Charge Temp', s.peakChargeTemp != null ? `${s.peakChargeTemp.toFixed(1)} °C` : '—'],
      ['Average Charge Temp', s.avgChargeTemp != null ? `${s.avgChargeTemp.toFixed(1)} °C` : '—'],
      ['Latest Pressure', s.latestPressure != null ? s.latestPressure.toFixed(2) : '—'],
      ['Latest Flow', s.latestFlow != null ? s.latestFlow.toFixed(2) : '—'],
      ['Open Alarms (Stoppages)', s.alarmOpenCount != null ? String(s.alarmOpenCount) : '—'],
    ];
    let r = headerRow + 1;
    for (const [label, val] of rows) {
      ws.getCell(r, 1).value = label;
      ws.getCell(r, 2).value = val;
      ws.getCell(r, 1).alignment = { horizontal: 'left', vertical: 'middle' };
      ws.getCell(r, 2).alignment = { horizontal: 'left', vertical: 'middle' };
      if (r % 2 === 0) {
        ws.getCell(r, 1).fill = fillSolid(ROW_ALT);
        ws.getCell(r, 2).fill = fillSolid(ROW_ALT);
      }
      thinBorder(ws, r, 1, 2);
      r += 1;
    }

    autoSize(ws, 2);
  }

  // ---------------- ChartsData ----------------
  {
    const ws = workbook.addWorksheet('ChartsData', { views: [{ state: 'frozen', ySplit: 1 }] });
    // Header row 1
    const headerRow = 1;
    const cols = [
      'taken_at',
      'stage_code',
      'charge_temp',
      'gas_temp',
      'fc_temp',
      'base_press',
      'base_fan_rpm',
      'n2h2_flow',
      'fuel_flow',
      'rcf_rpm',
    ];
    cols.forEach((c, i) => (ws.getCell(headerRow, i + 1).value = c));
    headerFill(ws, headerRow, 1, cols.length);
    ws.getRow(headerRow).height = 18;

    input.chartsDataRows.forEach((r) => {
      const nextRow = ws.addRow([
        r.takenAt,
        r.stageCode,
        r.chargeTemp,
        r.gasTemp,
        r.fcTemp,
        r.basePress,
        r.baseFanRpm,
        r.n2h2Flow,
        r.fuelFlow,
        r.rcfRpm,
      ]);
      void nextRow;
    });

    // Alternate row styling (data only, starting at row 2)
    const altFill = fillSolid(ROW_ALT);
    for (let rowIndex = 2; rowIndex <= ws.rowCount; rowIndex++) {
      if (rowIndex % 2 === 0) {
        for (let c = 1; c <= cols.length; c++) ws.getCell(rowIndex, c).fill = altFill;
      }
      thinBorder(ws, rowIndex, 1, cols.length);
    }

    autoSize(ws, cols.length);
  }

  // ---------------- ProductionTable ----------------
  {
    const ws = workbook.addWorksheet('ProductionTable', { views: [{ state: 'frozen', ySplit: 5 }] });

    // Banner block (rows 1-4)
    ws.mergeCells(1, 1, 1, 8);
    ws.getCell(1, 1).value = 'ANN Charge Production Table';
    ws.getCell(1, 1).font = { bold: true, size: 12, color: { argb: `FF${WHITE}` } };
    ws.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'left' };
    for (let c = 1; c <= 8; c++) ws.getCell(1, c).fill = fillSolid(BANNER);
    ws.getRow(1).height = 22;

    ws.mergeCells(3, 1, 3, 8);
    ws.getCell(3, 1).value = `Charge: ${input.scope.chargeNo} · Base/Batch: ${input.scope.baseNo}/${input.scope.annealingBatchNo}`;
    ws.getCell(3, 1).font = { bold: true, size: 10, color: { argb: 'FF334155' } };

    // Header row at row 5
    const headerRow = 5;
    const header = ['Timestamp', 'Parameter', 'Current Value', 'Minimum', 'Maximum', 'Average', 'Status', 'Remarks'];
    header.forEach((h, i) => {
      ws.getCell(headerRow, i + 1).value = h;
    });
    headerFill(ws, headerRow, 1, header.length);

    // Data rows start at 6
    let r = headerRow + 1;
    for (const row of input.productionTableRows) {
      ws.getCell(r, METRIC_COLS.TIMESTAMP).value = row.timestamp;
      ws.getCell(r, METRIC_COLS.PARAMETER).value = row.parameter;
      ws.getCell(r, METRIC_COLS.CURRENT).value = row.currentValue;
      ws.getCell(r, METRIC_COLS.MIN).value = row.min;
      ws.getCell(r, METRIC_COLS.MAX).value = row.max;
      ws.getCell(r, METRIC_COLS.AVG).value = row.avg;
      ws.getCell(r, METRIC_COLS.STATUS).value = row.status;
      ws.getCell(r, METRIC_COLS.REMARKS).value = row.remarks;

      if (r % 2 === 0) {
        for (let c = 1; c <= header.length; c++) ws.getCell(r, c).fill = fillSolid(ROW_ALT);
      }

      // Borders
      thinBorder(ws, r, 1, header.length);
      r += 1;
    }

    autoSize(ws, header.length);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

