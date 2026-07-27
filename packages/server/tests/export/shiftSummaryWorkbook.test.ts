import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildShiftSummaryWorkbook } from '../../src/export/render/ShiftSummaryWorkbookBuilder';
import type { CoilDetailRow } from '../../src/export/shiftSummary/loadShiftSummaryExportData';
import {
  mapStoppageRows,
  pickCrewName,
  prepareCompletedCoilsForExport,
} from '../../src/export/shiftSummary/loadShiftSummaryExportData';

const sampleCoil: CoilDetailRow = {
  orderId: '1',
  sno: 1,
  batchNumber: '2005605254',
  coilNo: 'HR-4471',
  status: 'COMPLETED',
  customer: 'ANIL INDUSTRIES',
  process: 'ROLLING',
  machine: '6HI',
  gradeSurface: 'CR/Full Hard',
  widthMm: 1250,
  incomingThkMm: 2.5,
  weightMt: 1.74,
  groupWeightMt: null,
  combinedGroupTag: '',
  annHardRwTension: '',
  finishedThkMm: 2.0,
  hardnessVpnHrb: '',
  btEcvMm: '',
  utsElong: '',
  loadStretch: '',
  pass1: 2.4,
  pass2: 2.2,
  pass3: null,
  pass4: null,
  pass5: null,
  pass6: null,
  finalThk: 2.0,
  totalPasses: 2,
  rwTension: '',
  rollFinish: 'M',
  rerolling: 'N',
  mi: '',
  defectCodes: '',
  timeFrom: '06:10',
  timeTo: '06:40',
  durationMin: 30,
  remarks: '',
  rollIn: 'WR/101',
  rollOut: 'WR/102',
  isSkinPass: false,
  isRolling: true,
};

describe('ShiftSummaryWorkbookBuilder', () => {
  it('builds 7 branded sheets with grouped production headers', async () => {
    const buf = await buildShiftSummaryWorkbook({
      summary: {
        prodDate: '2026-07-27',
        shiftCode: 'A',
        processLine: 'ROLLING',
        machines: '6HI',
        lineIncharge: 'Incharge A',
        shiftManager: 'Manager B',
        crew1: 'Crew One',
        crew2: '',
        crew3: '',
        operator: 'Op C',
        craneOperator: '',
        targetMt: 30,
        completedMt: 16.5,
        totalMt: 16.5,
        inProgressMt: 0,
        attainmentPct: 55,
        totalProdMt: 16.5,
        rollingMt: 16.5,
        rerollMt: 0,
        skinpassMt: 0,
        spMt: 0,
        spCoils: 0,
        rwMt: 16.5,
        rwCoils: 1,
        rejectionKg: 0,
        scrapKg: 12,
        scrapPct: 0.1,
        stoppageMin: 15,
        breakdownMin: 0,
        utilizationPct: 98,
        handoverMt: 16.5,
        openCoils: 0,
        handoverNotes: 'ok',
      },
      coils: [sampleCoil],
      stoppages: mapStoppageRows([
        {
          id: 's1',
          categoryCode: 'MECH',
          categoryLabel: 'Mechanical',
          requiresBreakdownCode: false,
          breakdownCode: '01',
          startAt: '2026-07-27T04:20:00.000Z',
          endAt: '2026-07-27T04:35:00.000Z',
          durationMin: 15,
          remarks: 'Guide roller',
        },
      ]),
      held: [
        {
          sno: 1,
          coilNo: 'HR-4480',
          batchNumber: '2005612500',
          customer: 'VENUS',
          machine: '6HI',
          weightMt: 1.22,
          heldBy: 'Op C',
          reasonDefect: '23 Buckling',
          timeHeld: '08:40',
        },
      ],
      rolls: {
        rollIn: 'WR/101',
        rollOut: 'WR/102',
        rollsIn: '',
        rollsOut: '',
        coolantTemp: 42,
        coolantPress: 1.2,
      },
      stoppageCodes: [{ code: '01', label: 'Mechanical', labelAlt: 'Mechanical' }],
      defectCodes: [{ code: '23', label: 'Buckling' }],
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Summary',
      'Production (Coils)',
      'Stoppages',
      'Held Orders',
      'Rolls & Consumables',
      'Stoppage Codes',
      'Defect Codes',
    ]);

    const summary = wb.getWorksheet('Summary')!;
    expect(summary.getCell('A1').value).toBe('Shift Summary');
    expect(summary.getCell('C4').value).toBe('2026-07-27');
    expect(summary.getCell('C5').value).toBe('A');
    expect(summary.getCell('B29').value).toBe('Scrap (Kg)');
    expect(summary.getCell('C29').value).toBe(12);

    const prod = wb.getWorksheet('Production (Coils)')!;
    expect(prod.getCell('A3').value).toBe('Identification');
    expect(prod.getCell('I3').value).toBe('Incoming Material');
    expect(prod.getCell('T3').value).toContain('Skin-Pass');
    expect(prod.getCell('C4').value).toBe('Batch Number');
    expect(prod.getCell('C5').value).toBe('2005605254');
    expect(prod.getCell('D5').value).toBe('HR-4471');
    expect(prod.getCell('T5').value).toBe(2.4);

    const stoppages = wb.getWorksheet('Stoppages')!;
    expect(stoppages.getCell('G3').value).toBe('Breakdown? (Y/N)');
    expect(stoppages.getCell('G4').value).toBe('N');

    const held = wb.getWorksheet('Held Orders')!;
    expect(held.getCell('G3').value).toBe('Held By (Crew/Op)');
    expect(held.getCell('G4').value).toBe('Op C');

    const rolls = wb.getWorksheet('Rolls & Consumables')!;
    expect(rolls.getCell('B4').value).toBe('WR/101');
    expect(rolls.getCell('B8').value).toBe(42);
    expect(rolls.getCell('B10').value).toBeNull();

    expect(wb.getWorksheet('Stoppage Codes')!.getCell('B4').value).toBe('Mechanical');
    expect(wb.getWorksheet('Defect Codes')!.getCell('B4').value).toBe('Buckling');
  });

  it('merges combined group cells for multi-member runs', async () => {
    const groupId = 'grp-1';
    const coils = prepareCompletedCoilsForExport([
      {
        ...sampleCoil,
        orderId: '1',
        batchNumber: 'B1',
        coilNo: 'C1',
        weightMt: 2,
        combinedGroupId: groupId,
      },
      {
        ...sampleCoil,
        orderId: '2',
        sno: 2,
        batchNumber: 'B2',
        coilNo: 'C2',
        weightMt: 3,
        combinedGroupId: groupId,
      },
    ]);

    expect(coils.length).toBe(2);
    expect(coils[0].combinedGroupTag).toBe('CG-1');
    expect(coils[1].combinedGroupTag).toBe('CG-1');
    expect(coils[0].groupWeightMt).toBe(5);

    const buf = await buildShiftSummaryWorkbook({
      summary: {
        prodDate: '2026-07-27',
        shiftCode: 'A',
        processLine: 'ROLLING',
        machines: '6HI',
        lineIncharge: '',
        shiftManager: '',
        crew1: '',
        crew2: '',
        crew3: '',
        operator: '',
        craneOperator: '',
        targetMt: 10,
        completedMt: 5,
        totalMt: 5,
        inProgressMt: 0,
        attainmentPct: 50,
        totalProdMt: 5,
        rollingMt: 5,
        rerollMt: 0,
        skinpassMt: 0,
        spMt: 0,
        spCoils: 0,
        rwMt: 5,
        rwCoils: 2,
        rejectionKg: 0,
        scrapKg: 0,
        scrapPct: 0,
        stoppageMin: 0,
        breakdownMin: 0,
        utilizationPct: 100,
        handoverMt: 5,
        openCoils: 0,
        handoverNotes: '',
      },
      coils,
      stoppages: [],
      held: [],
      rolls: {
        rollIn: '',
        rollOut: '',
        rollsIn: '',
        rollsOut: '',
        coolantTemp: '',
        coolantPress: '',
      },
      stoppageCodes: [],
      defectCodes: [],
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const prod = wb.getWorksheet('Production (Coils)')!;
    expect(prod.getCell('B5').value).toBe('CG-1');
    expect(prod.getCell('B6').value).toBe('CG-1');
    expect(prod.getCell('M5').value).toBe(5);
    expect(prod.getCell('L5').value).toBe(2);
    expect(prod.getCell('L6').value).toBe(3);
  });
});

describe('shift summary helpers', () => {
  it('pickCrewName matches role labels', () => {
    const crew = [
      { operatorName: 'Alice', roleCode: 'OPERATOR' },
      { operatorName: 'Bob', roleCode: 'CRANE OPERATOR' },
      { operatorName: 'Carol', roleCode: 'Shift Manager' },
    ];
    expect(pickCrewName(crew, /operator/i)).toBe('Alice');
    expect(pickCrewName(crew, /crane/i)).toBe('Bob');
    expect(pickCrewName(crew, /manager/i)).toBe('Carol');
  });

  it('mapStoppageRows sorts ascending and flags breakdown', () => {
    const rows = mapStoppageRows([
      {
        id: '2',
        categoryCode: 'BREAKDOWN',
        categoryLabel: 'Breakdown',
        startAt: '2026-07-27T10:00:00.000Z',
        endAt: '2026-07-27T10:20:00.000Z',
        durationMin: 20,
      },
      {
        id: '1',
        categoryCode: 'MECH',
        categoryLabel: 'Mechanical',
        startAt: '2026-07-27T08:00:00.000Z',
        endAt: '2026-07-27T08:10:00.000Z',
        durationMin: 10,
      },
    ]);
    expect(rows[0].codeName).toBe('Mechanical');
    expect(rows[1].breakdownYn).toBe('Y');
  });

  it('prepareCompletedCoilsForExport excludes in-progress and held', () => {
    const rows = prepareCompletedCoilsForExport([
      sampleCoil,
      { ...sampleCoil, sno: 2, batchNumber: 'B2', status: 'IN_PROGRESS' },
      { ...sampleCoil, sno: 3, batchNumber: 'B3', status: 'REJECTED' },
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0].batchNumber).toBe('2005605254');
  });
});
