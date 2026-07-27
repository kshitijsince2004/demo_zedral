import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import type {
  CoilDetailRow,
  CodeRefRow,
  HeldOrderRow,
  StoppageRow,
} from '../shiftSummary/loadShiftSummaryExportData';

const BANNER = '103028';
const GROUP = '1F3864';
const WHITE = 'FFFFFF';
const COMBINED_FILL = 'E8F0FE';
const DETERMINISTIC_EPOCH = new Date('2026-01-01T00:00:00.000Z');

/** Column indices (1-based) for Production (Coils) sheet. */
const COL = {
  SNO: 1,
  COMBINED_GROUP: 2,
  BATCH: 3,
  COIL: 4,
  STATUS: 5,
  CUSTOMER: 6,
  PROCESS: 7,
  MACHINE: 8,
  GRADE: 9,
  WIDTH: 10,
  INCOMING_THK: 11,
  WEIGHT: 12,
  GROUP_WEIGHT: 13,
  ANN_HARD: 14,
  FINISHED_THK: 15,
  HARDNESS: 16,
  BT_ECV: 17,
  UTS: 18,
  LOAD_STRETCH: 19,
  PASS1: 20,
  PASS2: 21,
  PASS3: 22,
  PASS4: 23,
  PASS5: 24,
  PASS6: 25,
  FINAL_THK: 26,
  TOTAL_PASSES: 27,
  RW_TENSION: 28,
  ROLL_FINISH: 29,
  REROLL: 30,
  MI: 31,
  DEFECT: 32,
  TIME_FROM: 33,
  TIME_TO: 34,
  DURATION: 35,
  REMARKS: 36,
} as const;

const MERGE_COLS = [
  COL.COMBINED_GROUP,
  COL.CUSTOMER,
  COL.MACHINE,
  COL.TIME_FROM,
  COL.TIME_TO,
  COL.DURATION,
  COL.GROUP_WEIGHT,
] as const;

export interface ShiftSummaryWorkbookInput {
  summary: {
    prodDate: string;
    shiftCode: string;
    processLine: string;
    machines: string;
    lineIncharge: string;
    shiftManager: string;
    crew1: string;
    crew2: string;
    crew3: string;
    operator: string;
    craneOperator: string;
    targetMt: number | string;
    completedMt: number | string;
    totalMt: number | string;
    inProgressMt: number | string;
    attainmentPct: number | string;
    totalProdMt: number | string;
    rollingMt: number | string;
    rerollMt: number | string;
    skinpassMt: number | string;
    spMt: number | string;
    spCoils: number | string;
    rwMt: number | string;
    rwCoils: number | string;
    rejectionKg: number | string;
    scrapKg: number | string;
    scrapPct: number | string;
    stoppageMin: number | string;
    breakdownMin: number | string;
    utilizationPct: number | string;
    handoverMt: number | string;
    openCoils: number | string;
    handoverNotes: string;
  };
  coils: CoilDetailRow[];
  stoppages: StoppageRow[];
  held: HeldOrderRow[];
  rolls: {
    rollIn: string;
    rollOut: string;
    rollsIn: string;
    rollsOut: string;
    coolantTemp: number | string;
    coolantPress: number | string;
  };
  stoppageCodes: CodeRefRow[];
  defectCodes: CodeRefRow[];
}

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

function fillSolid(hex: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } };
}

function styleBanner(ws: ExcelJS.Worksheet, title: string, lastCol: number, logoId: number) {
  ws.mergeCells(1, 1, 1, Math.max(lastCol - 1, 1));
  const cell = ws.getCell(1, 1);
  cell.value = title;
  cell.font = { bold: true, size: 15, color: { argb: `FF${WHITE}` } };
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
  for (let c = 1; c <= lastCol; c++) {
    ws.getCell(1, c).fill = fillSolid(BANNER);
  }
  ws.getRow(1).height = 28;
  ws.addImage(logoId, {
    tl: { col: Math.max(lastCol - 1, 0), row: 0 },
    ext: { width: 105, height: 33 },
  });
}

function styleGroupHeader(ws: ExcelJS.Worksheet, row: number, from: number, to: number, label: string) {
  if (to > from) ws.mergeCells(row, from, row, to);
  const cell = ws.getCell(row, from);
  cell.value = label;
  for (let c = from; c <= to; c++) {
    const cc = ws.getCell(row, c);
    cc.fill = fillSolid(GROUP);
    cc.font = { bold: true, size: 10, color: { argb: `FF${WHITE}` } };
    cc.alignment = { vertical: 'middle', horizontal: 'center' };
  }
}

function headerCell(ws: ExcelJS.Worksheet, row: number, col: number, value: string) {
  const cell = ws.getCell(row, col);
  cell.value = value;
  cell.font = { bold: true, size: 10 };
}

function setVal(ws: ExcelJS.Worksheet, row: number, col: number, value: string | number | null | undefined) {
  if (value === '' || value == null) {
    ws.getCell(row, col).value = null;
    return;
  }
  ws.getCell(row, col).value = value;
}

function applyCombinedGroupMerges(ws: ExcelJS.Worksheet, coils: CoilDetailRow[], dataStartRow: number) {
  let i = 0;
  while (i < coils.length) {
    const tag = coils[i].combinedGroupTag;
    if (!tag) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < coils.length && coils[j].combinedGroupTag === tag) j += 1;
    if (j - i < 2) {
      i = j;
      continue;
    }
    const top = dataStartRow + i;
    const bottom = dataStartRow + j - 1;
    for (const col of MERGE_COLS) {
      ws.mergeCells(top, col, bottom, col);
      for (let r = top; r <= bottom; r++) {
        const cell = ws.getCell(r, col);
        cell.fill = fillSolid(COMBINED_FILL);
        cell.border = {
          left: { style: 'medium', color: { argb: `FF${GROUP}` } },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    }
    i = j;
  }
}

export async function buildShiftSummaryWorkbook(input: ShiftSummaryWorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zedral';
  workbook.created = DETERMINISTIC_EPOCH;
  workbook.modified = DETERMINISTIC_EPOCH;

  const logoPath = assetPath('assets', 'export', 'zedral_logo_white.png');
  const logoId = workbook.addImage({
    buffer: fs.readFileSync(logoPath) as unknown as ExcelJS.Buffer,
    extension: 'png',
  });

  // --- Summary ---
  {
    const ws = workbook.addWorksheet('Summary', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.getColumn(1).width = 20;
    ws.getColumn(2).width = 30;
    ws.getColumn(3).width = 24;
    styleBanner(ws, 'Shift Summary', 3, logoId);

    headerCell(ws, 3, 1, 'Section');
    headerCell(ws, 3, 2, 'Metric');
    headerCell(ws, 3, 3, 'Value');
    for (let c = 1; c <= 3; c++) {
      ws.getCell(3, c).fill = fillSolid(GROUP);
      ws.getCell(3, c).font = { bold: true, size: 10, color: { argb: `FF${WHITE}` } };
    }

    const s = input.summary;
    const rows: Array<[string, string, string | number]> = [
      ['Header', 'Production Date', s.prodDate],
      ['', 'Shift', s.shiftCode],
      ['', 'Process Line', s.processLine],
      ['', 'Machine', s.machines],
      ['', 'Line / Shift Incharge', s.lineIncharge],
      ['', 'Shift Manager', s.shiftManager],
      ['', 'Crew 1', s.crew1],
      ['', 'Crew 2', s.crew2],
      ['', 'Crew 3', s.crew3],
      ['', 'Operator', s.operator],
      ['', 'Crane Operator', s.craneOperator],
      ['Targets & Output', 'Target MT', s.targetMt],
      ['', 'Completed MT', s.completedMt],
      ['', 'Total MT', s.totalMt],
      ['', 'In Progress MT', s.inProgressMt],
      ['', 'Attainment %', s.attainmentPct],
      ['Production Split', 'Total Prod. MT', s.totalProdMt],
      ['', 'Rolling MT', s.rollingMt],
      ['', 'Re-Rolling MT', s.rerollMt],
      ['', 'Skin-Pass MT', s.skinpassMt],
      ['', 'Total S/P (MT)', s.spMt],
      ['', 'No. of S/P Coils', s.spCoils],
      ['', 'Total R/W (MT)', s.rwMt],
      ['', 'No. of R/W Coils', s.rwCoils],
      ['Quality & Losses', 'Rejection (Kg)', s.rejectionKg],
      ['', 'Scrap (Kg)', s.scrapKg],
      ['', 'Scrap %', s.scrapPct],
      ['Downtime', 'Stoppage Minutes', s.stoppageMin],
      ['', 'Breakdown Minutes', s.breakdownMin],
      ['', 'Utilization %', s.utilizationPct],
      ['Handover', 'Produced MT (Handover)', s.handoverMt],
      ['', 'Open Coils', s.openCoils],
      ['', 'Handover Notes', s.handoverNotes],
    ];
    rows.forEach((r, i) => {
      const row = 4 + i;
      if (r[0]) {
        ws.getCell(row, 1).value = r[0];
        ws.getCell(row, 1).font = { bold: true, size: 10 };
      }
      ws.getCell(row, 2).value = r[1];
      setVal(ws, row, 3, r[2]);
    });
  }

  // --- Production (Coils) ---
  {
    const ws = workbook.addWorksheet('Production (Coils)');
    const lastCol = COL.REMARKS;
    styleBanner(ws, 'Production — Coil Detail (completed orders only)', lastCol, logoId);
    styleGroupHeader(ws, 3, COL.SNO, COL.MACHINE, 'Identification');
    styleGroupHeader(ws, 3, COL.GRADE, COL.ANN_HARD, 'Incoming Material');
    styleGroupHeader(ws, 3, COL.FINISHED_THK, COL.LOAD_STRETCH, 'After Temper Rolling (Temper Mills)');
    styleGroupHeader(ws, 3, COL.PASS1, COL.REROLL, 'Skin-Pass — Actual Thickness in Passes (6HI)');
    styleGroupHeader(ws, 3, COL.MI, COL.DEFECT, 'Quality');
    styleGroupHeader(ws, 3, COL.TIME_FROM, COL.DURATION, 'Time Taken');
    styleGroupHeader(ws, 3, COL.REMARKS, COL.REMARKS, 'Notes');

    const headers: Array<[number, string]> = [
      [COL.SNO, 'S.No.'],
      [COL.COMBINED_GROUP, 'Combined Group'],
      [COL.BATCH, 'Batch Number'],
      [COL.COIL, 'Coil No.'],
      [COL.STATUS, 'Status'],
      [COL.CUSTOMER, 'Customer'],
      [COL.PROCESS, 'Process'],
      [COL.MACHINE, 'Machine'],
      [COL.GRADE, 'Grade / Surface Finish'],
      [COL.WIDTH, 'Width (mm)'],
      [COL.INCOMING_THK, 'Incoming Thk (mm)'],
      [COL.WEIGHT, 'Weight (MT)'],
      [COL.GROUP_WEIGHT, 'Group Weight (MT)'],
      [COL.ANN_HARD, 'Ann.Hard / R.W Tension'],
      [COL.FINISHED_THK, 'Finished Thk (mm)'],
      [COL.HARDNESS, 'Hardness VPN/HRB'],
      [COL.BT_ECV, 'B.T. ECV (mm)'],
      [COL.UTS, 'UTS / Elong.'],
      [COL.LOAD_STRETCH, 'Load% / Stretch%'],
      [COL.PASS1, 'Pass 1'],
      [COL.PASS2, 'Pass 2'],
      [COL.PASS3, 'Pass 3'],
      [COL.PASS4, 'Pass 4'],
      [COL.PASS5, 'Pass 5'],
      [COL.PASS6, 'Pass 6'],
      [COL.FINAL_THK, 'Final Thk'],
      [COL.TOTAL_PASSES, 'Total Passes'],
      [COL.RW_TENSION, 'R/W Tension'],
      [COL.ROLL_FINISH, 'Roll Finish (M/B)'],
      [COL.REROLL, 'Re-Rolling (Y/N)'],
      [COL.MI, 'M.I.'],
      [COL.DEFECT, 'Defect Code(s)'],
      [COL.TIME_FROM, 'Time From'],
      [COL.TIME_TO, 'Time To'],
      [COL.DURATION, 'Duration (min)'],
      [COL.REMARKS, 'Remarks'],
    ];
    headers.forEach(([col, label]) => headerCell(ws, 4, col, label));
    const widths = [6, 12, 13, 12, 12, 22, 12, 10, 16, 10, 12, 10, 12, 14, 12, 12, 10, 10, 12, 7, 7, 7, 7, 7, 7, 9, 10, 10, 12, 10, 6, 14, 10, 10, 12, 20];
    widths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });

    const dataStartRow = 5;
    input.coils.forEach((c, idx) => {
      const row = dataStartRow + idx;
      setVal(ws, row, COL.SNO, c.sno);
      setVal(ws, row, COL.COMBINED_GROUP, c.combinedGroupTag || null);
      setVal(ws, row, COL.BATCH, c.batchNumber);
      setVal(ws, row, COL.COIL, c.coilNo);
      setVal(ws, row, COL.STATUS, c.status);
      setVal(ws, row, COL.CUSTOMER, c.customer);
      setVal(ws, row, COL.PROCESS, c.process);
      setVal(ws, row, COL.MACHINE, c.machine);
      setVal(ws, row, COL.GRADE, c.gradeSurface);
      setVal(ws, row, COL.WIDTH, c.widthMm);
      setVal(ws, row, COL.INCOMING_THK, c.incomingThkMm);
      setVal(ws, row, COL.WEIGHT, c.weightMt);
      setVal(ws, row, COL.GROUP_WEIGHT, c.groupWeightMt);
      setVal(ws, row, COL.ANN_HARD, c.annHardRwTension || null);
      setVal(ws, row, COL.FINISHED_THK, c.finishedThkMm);
      setVal(ws, row, COL.HARDNESS, c.hardnessVpnHrb || null);
      setVal(ws, row, COL.BT_ECV, c.btEcvMm || null);
      setVal(ws, row, COL.UTS, c.utsElong || null);
      setVal(ws, row, COL.LOAD_STRETCH, c.loadStretch || null);
      setVal(ws, row, COL.PASS1, c.pass1);
      setVal(ws, row, COL.PASS2, c.pass2);
      setVal(ws, row, COL.PASS3, c.pass3);
      setVal(ws, row, COL.PASS4, c.pass4);
      setVal(ws, row, COL.PASS5, c.pass5);
      setVal(ws, row, COL.PASS6, c.pass6);
      setVal(ws, row, COL.FINAL_THK, c.finalThk);
      setVal(ws, row, COL.TOTAL_PASSES, c.totalPasses);
      setVal(ws, row, COL.RW_TENSION, c.rwTension || null);
      setVal(ws, row, COL.ROLL_FINISH, c.rollFinish || null);
      setVal(ws, row, COL.REROLL, c.rerolling || null);
      setVal(ws, row, COL.MI, c.mi || null);
      setVal(ws, row, COL.DEFECT, c.defectCodes || null);
      setVal(ws, row, COL.TIME_FROM, c.timeFrom || null);
      setVal(ws, row, COL.TIME_TO, c.timeTo || null);
      setVal(ws, row, COL.DURATION, c.durationMin);
      setVal(ws, row, COL.REMARKS, c.remarks || null);
    });

    applyCombinedGroupMerges(ws, input.coils, dataStartRow);
  }

  // --- Stoppages ---
  {
    const ws = workbook.addWorksheet('Stoppages');
    styleBanner(ws, 'Stoppages / Downtime Log', 8, logoId);
    const headers = ['S.No.', 'From', 'To', 'Total (min)', 'Code', 'Code Name', 'Breakdown? (Y/N)', 'Reason'];
    headers.forEach((h, i) => {
      headerCell(ws, 3, i + 1, h);
      ws.getCell(3, i + 1).fill = fillSolid(GROUP);
      ws.getCell(3, i + 1).font = { bold: true, size: 10, color: { argb: `FF${WHITE}` } };
    });
    [6, 10, 10, 12, 10, 18, 16, 28].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    input.stoppages.forEach((s, idx) => {
      const row = 4 + idx;
      setVal(ws, row, 1, s.sno);
      setVal(ws, row, 2, s.from);
      setVal(ws, row, 3, s.to);
      setVal(ws, row, 4, s.totalMin);
      setVal(ws, row, 5, s.code);
      setVal(ws, row, 6, s.codeName);
      setVal(ws, row, 7, s.breakdownYn);
      setVal(ws, row, 8, s.reason);
    });
  }

  // --- Held Orders ---
  {
    const ws = workbook.addWorksheet('Held Orders');
    styleBanner(ws, 'Held Orders (HOLD)', 9, logoId);
    const headers = [
      'S.No.', 'Coil No.', 'Batch Number', 'Customer', 'Machine', 'Weight (MT)',
      'Held By (Crew/Op)', 'Reason / Defect Code', 'Time Held',
    ];
    headers.forEach((h, i) => {
      headerCell(ws, 3, i + 1, h);
      ws.getCell(3, i + 1).fill = fillSolid(GROUP);
      ws.getCell(3, i + 1).font = { bold: true, size: 10, color: { argb: `FF${WHITE}` } };
    });
    [6, 12, 13, 22, 10, 12, 16, 22, 10].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    input.held.forEach((h, idx) => {
      const row = 4 + idx;
      setVal(ws, row, 1, h.sno);
      setVal(ws, row, 2, h.coilNo);
      setVal(ws, row, 3, h.batchNumber);
      setVal(ws, row, 4, h.customer);
      setVal(ws, row, 5, h.machine);
      setVal(ws, row, 6, h.weightMt);
      setVal(ws, row, 7, h.heldBy);
      setVal(ws, row, 8, h.reasonDefect);
      setVal(ws, row, 9, h.timeHeld);
    });
  }

  // --- Rolls & Consumables ---
  {
    const ws = workbook.addWorksheet('Rolls & Consumables');
    styleBanner(ws, 'Rolls & Consumables', 4, logoId);
    ['Item', 'Value', 'Unit', 'Applies To'].forEach((h, i) => {
      headerCell(ws, 3, i + 1, h);
      ws.getCell(3, i + 1).fill = fillSolid(GROUP);
      ws.getCell(3, i + 1).font = { bold: true, size: 10, color: { argb: `FF${WHITE}` } };
    });
    [22, 18, 12, 14].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    const r = input.rolls;
    const items: Array<[string, string | number, string, string]> = [
      ['Roll In (roll ID)', r.rollIn, '', 'Temper mills'],
      ['Roll Out (roll ID)', r.rollOut, '', 'Temper mills'],
      ['Rolls In', r.rollsIn, '', 'Skin-Pass'],
      ['Rolls Out', r.rollsOut, '', 'Skin-Pass'],
      ['Coolant Temp', r.coolantTemp, '°C', 'Skin-Pass'],
      ['Coolant Press', r.coolantPress, 'Kg/cm²', 'Skin-Pass'],
      ['Oil Initial Level', '', '', 'Temper mills'],
      ['Oil Final Level', '', '', 'Temper mills'],
      ['Oil Consumption', '', '', 'Temper mills'],
    ];
    items.forEach((it, idx) => {
      const row = 4 + idx;
      setVal(ws, row, 1, it[0]);
      setVal(ws, row, 2, it[1] === '' ? null : it[1]);
      setVal(ws, row, 3, it[2] || null);
      setVal(ws, row, 4, it[3]);
    });
  }

  // --- Stoppage Codes ---
  {
    const ws = workbook.addWorksheet('Stoppage Codes');
    styleBanner(ws, 'Stoppage Codes (reference)', 3, logoId);
    ws.getCell(2, 1).value = 'Codes resolved from master.stoppage_category.';
    ['Code', 'Temper Mills (4HI / 6HI)', 'Skin-Pass (6HI)'].forEach((h, i) => {
      headerCell(ws, 3, i + 1, h);
      ws.getCell(3, i + 1).fill = fillSolid(GROUP);
      ws.getCell(3, i + 1).font = { bold: true, size: 10, color: { argb: `FF${WHITE}` } };
    });
    [8, 28, 28].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    input.stoppageCodes.forEach((c, idx) => {
      const row = 4 + idx;
      setVal(ws, row, 1, c.code);
      setVal(ws, row, 2, c.label);
      setVal(ws, row, 3, c.labelAlt ?? c.label);
    });
  }

  // --- Defect Codes ---
  {
    const ws = workbook.addWorksheet('Defect Codes');
    styleBanner(ws, 'Defect Codes (reference)', 4, logoId);
    ['Code', 'Defect', 'Symbol', 'Note'].forEach((h, i) => {
      headerCell(ws, 3, i + 1, h);
      ws.getCell(3, i + 1).fill = fillSolid(GROUP);
      ws.getCell(3, i + 1).font = { bold: true, size: 10, color: { argb: `FF${WHITE}` } };
    });
    [8, 28, 10, 24].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    input.defectCodes.forEach((c, idx) => {
      const row = 4 + idx;
      setVal(ws, row, 1, c.code);
      setVal(ws, row, 2, c.label);
      setVal(ws, row, 3, c.symbol ?? null);
      setVal(ws, row, 4, c.note ?? null);
    });
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
