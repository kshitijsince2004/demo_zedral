import type { AuthUser } from '../../services/authService';
import { ReportingService } from '../../services/ReportingService';
import { SixHiService } from '../../services/SixHiService';
import type { ExportFormat, ReportExecutionResult } from '../types';
import type { ReportDefinition } from './ReportDefinition';
import { currentPlantDate, postgresDateOnly } from '../../utils/dateOnly';
import {
  loadCoilDetails,
  loadDefectCodeRefs,
  loadHeldOrders,
  loadShiftLogLeaders,
  loadShiftManagerName,
  loadStoppageCodeRefs,
  mapStoppageRows,
  pickCrewName,
  prepareCompletedCoilsForExport,
  rejectionKgFromCoils,
  type CoilDetailRow,
} from '../shiftSummary/loadShiftSummaryExportData';
import { buildShiftSummaryWorkbook } from '../render/ShiftSummaryWorkbookBuilder';

interface ShiftSummaryScope {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  shiftCode?: string;
  machineCodes?: string[];
}

function parseScope(scope: Record<string, unknown>): ShiftSummaryScope {
  const date = scope.date ?? scope.shiftDate ?? scope.shift_date;
  const dateFrom = scope.dateFrom ?? scope.date_from ?? date;
  const dateTo = scope.dateTo ?? scope.date_to ?? dateFrom;
  const shiftRaw = scope.shiftCode ?? scope.shift ?? scope.shift_code;
  let machineCodes: string[] | undefined;
  const machines = scope.machineCodes ?? scope.machine_codes ?? scope.machines ?? scope.machine;
  if (Array.isArray(machines)) {
    machineCodes = machines.map(String);
  } else if (typeof machines === 'string' && machines.trim()) {
    machineCodes = machines.split(',').map((s) => s.trim()).filter(Boolean);
  }

  return {
    date: date ? postgresDateOnly(String(date)) : undefined,
    dateFrom: dateFrom ? postgresDateOnly(String(dateFrom)) : undefined,
    dateTo: dateTo ? postgresDateOnly(String(dateTo)) : undefined,
    shiftCode: shiftRaw ? String(shiftRaw).toUpperCase() : undefined,
    machineCodes,
  };
}

function applyMachineScope(user: AuthUser, machineCodes?: string[]): string[] | undefined {
  const isMachineHead = user.roles.includes('MACHINE_HEAD');
  if (!isMachineHead) return machineCodes;

  const allowed = (user.machineAccess ?? []).map((m) => m.toUpperCase());
  if (allowed.length === 0) return [];
  if (!machineCodes?.length) return allowed;
  return machineCodes.map((m) => m.toUpperCase()).filter((m) => allowed.includes(m));
}

/** Policy A — one workbook per mill (4HI / 6HI / 2HI). */
function resolveSingleMachineCode(user: AuthUser, machineCodes?: string[]): string {
  const scoped = applyMachineScope(user, machineCodes);
  if (scoped && scoped.length === 1) return scoped[0];
  if (scoped && scoped.length > 1) {
    throw new Error('Select exactly one machine (4HI, 6HI, or 2HI) for shift summary export');
  }
  if (scoped && scoped.length === 0) {
    throw new Error('No machine access for shift summary export');
  }
  if (!machineCodes?.length) {
    throw new Error('machineCodes is required — specify one mill (e.g. 4HI, 6HI, 2HI)');
  }
  const normalized = machineCodes.map((m) => m.trim().toUpperCase()).filter(Boolean);
  if (normalized.length !== 1) {
    throw new Error('Select exactly one machine (4HI, 6HI, or 2HI) for shift summary export');
  }
  return normalized[0];
}

function blank(v: unknown): string | number {
  if (v == null || v === '') return '—';
  return v as string | number;
}

function coilToFlatRow(c: CoilDetailRow): Record<string, unknown> {
  return {
    'S.No.': c.sno,
    'Combined Group': c.combinedGroupTag || '',
    'Batch Number': c.batchNumber,
    'Coil No.': c.coilNo,
    Status: c.status,
    Customer: c.customer,
    Process: c.process,
    Machine: c.machine,
    'Grade / Surface Finish': c.gradeSurface,
    'Width (mm)': c.widthMm ?? '',
    'Incoming Thk (mm)': c.incomingThkMm ?? '',
    'Weight (MT)': c.weightMt ?? '',
    'Group Weight (MT)': c.groupWeightMt ?? '',
    'Ann.Hard / R.W Tension': c.annHardRwTension,
    'Finished Thk (mm)': c.finishedThkMm ?? '',
    'Hardness VPN/HRB': c.hardnessVpnHrb,
    'B.T. ECV (mm)': c.btEcvMm,
    'UTS / Elong.': c.utsElong,
    'Load% / Stretch%': c.loadStretch,
    'Pass 1': c.pass1 ?? '',
    'Pass 2': c.pass2 ?? '',
    'Pass 3': c.pass3 ?? '',
    'Pass 4': c.pass4 ?? '',
    'Pass 5': c.pass5 ?? '',
    'Pass 6': c.pass6 ?? '',
    'Final Thk': c.finalThk ?? '',
    'Total Passes': c.totalPasses ?? '',
    'R/W Tension': c.rwTension,
    'Roll Finish (M/B)': c.rollFinish,
    'Re-Rolling (Y/N)': c.rerolling,
    'M.I.': c.mi,
    'Defect Code(s)': c.defectCodes,
    'Time From': c.timeFrom,
    'Time To': c.timeTo,
    'Duration (min)': c.durationMin ?? '',
    Remarks: c.remarks,
  };
}

function buildHtml(
  title: string,
  summaryRows: Record<string, unknown>[],
  coilRows: Record<string, unknown>[],
): string {
  const summaryTable = summaryRows
    .map((r) => `<tr>${Object.values(r).map((v) => `<td>${String(v ?? '')}</td>`).join('')}</tr>`)
    .join('');
  const coilTable = coilRows
    .map((r) => `<tr>${Object.values(r).map((v) => `<td>${String(v ?? '')}</td>`).join('')}</tr>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;font-size:12px}table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}h2{margin-top:24px}</style></head><body>
<h1>${title}</h1>
<h2>Summary</h2><table><tbody>${summaryTable}</tbody></table>
<h2>Production (Coils)</h2><table><tbody>${coilTable}</tbody></table>
</body></html>`;
}

export const ShiftSummaryReport: ReportDefinition = {
  id: 'SHIFT_SUMMARY',

  validateScope(scope: Record<string, unknown>) {
    const parsed = parseScope(scope);
    if (!parsed.dateFrom) throw new Error('date is required');
    if (!parsed.shiftCode) throw new Error('shiftCode is required');
  },

  supportedFormats(): ExportFormat[] {
    return ['CSV', 'XLSX', 'PDF'];
  },

  async estimateRowCount(scope: Record<string, unknown>, user: AuthUser): Promise<number> {
    const parsed = parseScope(scope);
    if (!parsed.dateFrom || !parsed.shiftCode) return 0;
    const machineCode = resolveSingleMachineCode(user, parsed.machineCodes);
    const shiftLogId = await SixHiService.resolveShiftLogIdForPlan(parsed.dateFrom, parsed.shiftCode);
    if (!shiftLogId) return 0;
    const review = await ReportingService.getShiftReview(shiftLogId, machineCode);
    if (!review) return 0;
    return (review.completedOrders?.length ?? 0) + 5;
  },

  async execute(
    scope: Record<string, unknown>,
    format: ExportFormat,
    user: AuthUser,
  ): Promise<ReportExecutionResult> {
    if (!this.supportedFormats().includes(format)) {
      throw new Error(`Format ${format} not supported for SHIFT_SUMMARY export`);
    }

    const parsed = parseScope(scope);
    if (!parsed.dateFrom) throw new Error('date is required');
    if (!parsed.shiftCode) throw new Error('shiftCode is required');

    const machineCode = resolveSingleMachineCode(user, parsed.machineCodes);
    const shiftLogId = await SixHiService.resolveShiftLogIdForPlan(parsed.dateFrom, parsed.shiftCode);
    if (!shiftLogId) {
      throw new Error(`No shift log found for ${parsed.dateFrom} shift ${parsed.shiftCode}`);
    }

    const [review, handover, coils, held, stoppageCodes, defectCodes, shiftManagerFallback, shiftLeaders] =
      await Promise.all([
        ReportingService.getShiftReview(shiftLogId, machineCode),
        ReportingService.getMachineHandoverSummary(shiftLogId).catch(() => null),
        loadCoilDetails(shiftLogId, machineCode),
        loadHeldOrders(shiftLogId, machineCode),
        loadStoppageCodeRefs(),
        loadDefectCodeRefs(),
        loadShiftManagerName(shiftLogId),
        loadShiftLogLeaders(shiftLogId),
      ]);
    if (!review) throw new Error('Shift review data not available');

    const exportCoils = prepareCompletedCoilsForExport(coils);
    const crew = review.crew ?? [];
    const stoppageRows = mapStoppageRows(review.stoppages ?? []);

    const spCoils = exportCoils.filter((c) => c.isSkinPass);
    const rwCoils = exportCoils.filter((c) => c.isRolling);
    const spMt = spCoils.reduce((s, c) => s + (c.weightMt ?? 0), 0);
    const rwMt = rwCoils.reduce((s, c) => s + (c.weightMt ?? 0), 0);
    const scrapKg = review.readings?.scrapKg ?? null;
    const totalProdMt = review.overview.totalProdMt ?? 0;
    const scrapPct =
      scrapKg != null && totalProdMt > 0
        ? Math.round(((scrapKg / 1000) / totalProdMt) * 1000) / 10
        : '';

    const ov = review.overview as typeof review.overview & {
      totalRollingMt?: number;
      totalRerollMt?: number;
      totalSkinpassMt?: number;
    };

    const lineIncharge =
      shiftLeaders.lineIncharge ||
      pickCrewName(crew, /incharge|in-charge|line\s*in/i) ||
      pickCrewName(crew, /shift\s*incharge/i);
    const shiftManager =
      shiftLeaders.shiftManager ||
      pickCrewName(crew, /shift\s*manager|manager/i) ||
      shiftManagerFallback;
    const operator =
      crew.find(
        (c) => /operator/i.test(c.roleCode ?? '') && !/crane/i.test(c.roleCode ?? ''),
      )?.operatorName || '';
    const craneOperator = pickCrewName(crew, /crane/i);
    const crewMembers = crew.filter(
      (c) => !/operator|crane|manager|incharge|in-charge/i.test(c.roleCode ?? ''),
    );
    const crew1 =
      pickCrewName(crew, /crew\s*1|^c1$/i) || crewMembers[0]?.operatorName || '';
    const crew2 =
      pickCrewName(crew, /crew\s*2|^c2$/i) || crewMembers[1]?.operatorName || '';
    const crew3 =
      pickCrewName(crew, /crew\s*3|^c3$/i) || crewMembers[2]?.operatorName || '';

    const rollingWithRoll = exportCoils.find((c) => c.isRolling && (c.rollIn || c.rollOut));
    const skinWithRoll = exportCoils.find((c) => c.isSkinPass && (c.rollIn || c.rollOut));

    const targetMt = shiftLeaders.targetMt ?? review.overview.targetMt;

    const summaryMetrics: Array<{ Metric: string; Value: string | number }> = [
      { Metric: 'Production Date', Value: review.prodDate },
      { Metric: 'Shift', Value: review.shiftCode },
      { Metric: 'Process Line', Value: review.processLine ?? '—' },
      { Metric: 'Machine', Value: machineCode },
      { Metric: 'Line / Shift Incharge', Value: blank(lineIncharge) },
      { Metric: 'Shift Manager', Value: blank(shiftManager) },
      { Metric: 'Crew 1', Value: blank(crew1) },
      { Metric: 'Crew 2', Value: blank(crew2) },
      { Metric: 'Crew 3', Value: blank(crew3) },
      { Metric: 'Operator', Value: blank(operator) },
      { Metric: 'Crane Operator', Value: blank(craneOperator) },
      { Metric: 'Target MT', Value: targetMt },
      { Metric: 'Completed MT', Value: review.overview.completedProdMt },
      { Metric: 'Total MT', Value: review.overview.totalProdMt },
      { Metric: 'In Progress MT', Value: review.overview.inProgressProdMt },
      { Metric: 'Attainment %', Value: review.overview.attainmentPct },
      { Metric: 'Total Prod. MT', Value: ov.totalProdMt ?? 0 },
      { Metric: 'Rolling MT', Value: ov.totalRollingMt ?? 0 },
      { Metric: 'Re-Rolling MT', Value: ov.totalRerollMt ?? 0 },
      { Metric: 'Skin-Pass MT', Value: ov.totalSkinpassMt ?? 0 },
      { Metric: 'Total S/P (MT)', Value: Math.round(spMt * 1000) / 1000 },
      { Metric: 'No. of S/P Coils', Value: spCoils.length },
      { Metric: 'Total R/W (MT)', Value: Math.round(rwMt * 1000) / 1000 },
      { Metric: 'No. of R/W Coils', Value: rwCoils.length },
      { Metric: 'Rejection (Kg)', Value: Math.round(rejectionKgFromCoils(coils) * 10) / 10 },
      { Metric: 'Scrap (Kg)', Value: scrapKg ?? '—' },
      { Metric: 'Scrap %', Value: scrapPct === '' ? '—' : scrapPct },
      { Metric: 'Stoppage Minutes', Value: review.metrics.totalStoppageMinutes },
      { Metric: 'Breakdown Minutes', Value: review.metrics.totalBreakdownMinutes },
      { Metric: 'Utilization %', Value: review.metrics.machineUtilizationPct },
      { Metric: 'Produced MT (Handover)', Value: handover?.producedMt ?? '—' },
      { Metric: 'Open Coils', Value: handover?.openCoilCount ?? '—' },
      { Metric: 'Handover Notes', Value: handover?.notes ?? '—' },
    ];

    const productionFlat = exportCoils.map(coilToFlatRow);
    const stoppageFlat = stoppageRows.map((s) => ({
      'S.No.': s.sno,
      From: s.from,
      To: s.to,
      'Total (min)': s.totalMin ?? '',
      Code: s.code,
      'Code Name': s.codeName,
      'Breakdown? (Y/N)': s.breakdownYn,
      Reason: s.reason,
    }));
    const heldFlat = held.map((h) => ({
      'S.No.': h.sno,
      'Coil No.': h.coilNo,
      'Batch Number': h.batchNumber,
      Customer: h.customer,
      Machine: h.machine,
      'Weight (MT)': h.weightMt ?? '',
      'Held By (Crew/Op)': h.heldBy,
      'Reason / Defect Code': h.reasonDefect,
      'Time Held': h.timeHeld,
    }));
    const rollsFlat = [
      { Item: 'Roll In (roll ID)', Value: rollingWithRoll?.rollIn || '', Unit: '', 'Applies To': 'Temper mills' },
      { Item: 'Roll Out (roll ID)', Value: rollingWithRoll?.rollOut || '', Unit: '', 'Applies To': 'Temper mills' },
      { Item: 'Rolls In', Value: skinWithRoll?.rollIn || '', Unit: '', 'Applies To': 'Skin-Pass' },
      { Item: 'Rolls Out', Value: skinWithRoll?.rollOut || '', Unit: '', 'Applies To': 'Skin-Pass' },
      {
        Item: 'Coolant Temp',
        Value: review.readings?.coolantTempDegC ?? '',
        Unit: '°C',
        'Applies To': 'Skin-Pass',
      },
      {
        Item: 'Coolant Press',
        Value: review.readings?.coolantPressKgCm2 ?? '',
        Unit: 'Kg/cm²',
        'Applies To': 'Skin-Pass',
      },
      { Item: 'Oil Initial Level', Value: '', Unit: '', 'Applies To': 'Temper mills' },
      { Item: 'Oil Final Level', Value: '', Unit: '', 'Applies To': 'Temper mills' },
      { Item: 'Oil Consumption', Value: '', Unit: '', 'Applies To': 'Temper mills' },
    ];
    const stoppageCodeFlat = stoppageCodes.map((c) => ({
      Code: c.code,
      'Temper Mills (4HI / 6HI)': c.label,
      'Skin-Pass (6HI)': c.labelAlt ?? c.label,
    }));
    const defectCodeFlat = defectCodes.map((c) => ({
      Code: c.code,
      Defect: c.label,
      Symbol: c.symbol ?? '',
    }));

    const today = currentPlantDate();
    const ext = format === 'XLSX' ? 'xlsx' : format === 'PDF' ? 'pdf' : 'csv';
    const scopeLabel = `${parsed.dateFrom}_shift-${parsed.shiftCode}_${machineCode}`;

    const result: ReportExecutionResult = {
      rows: summaryMetrics,
      filename: `shift_summary_${scopeLabel}_${today}.${ext}`,
      dataVersion: `SHIFT:${shiftLogId}:${machineCode}:${exportCoils.length}`,
      rowCount: summaryMetrics.length + exportCoils.length,
      deterministic: true,
      sheets: [
        { name: 'Summary', rows: summaryMetrics },
        { name: 'Production (Coils)', rows: productionFlat },
        { name: 'Stoppages', rows: stoppageFlat },
        { name: 'Held Orders', rows: heldFlat },
        { name: 'Rolls & Consumables', rows: rollsFlat },
        { name: 'Stoppage Codes', rows: stoppageCodeFlat },
        { name: 'Defect Codes', rows: defectCodeFlat },
      ],
      html: buildHtml(
        `Shift Summary ${parsed.dateFrom} · Shift ${parsed.shiftCode} · ${machineCode}`,
        summaryMetrics,
        productionFlat,
      ),
    };

    if (format === 'XLSX') {
      result.templateBuffer = await buildShiftSummaryWorkbook({
        summary: {
          prodDate: review.prodDate,
          shiftCode: review.shiftCode,
          processLine: review.processLine ?? '',
          machines: machineCode,
          lineIncharge,
          shiftManager,
          crew1,
          crew2,
          crew3,
          operator,
          craneOperator,
          targetMt,
          completedMt: review.overview.completedProdMt,
          totalMt: review.overview.totalProdMt,
          inProgressMt: review.overview.inProgressProdMt,
          attainmentPct: review.overview.attainmentPct,
          totalProdMt: ov.totalProdMt ?? 0,
          rollingMt: ov.totalRollingMt ?? 0,
          rerollMt: ov.totalRerollMt ?? 0,
          skinpassMt: ov.totalSkinpassMt ?? 0,
          spMt: Math.round(spMt * 1000) / 1000,
          spCoils: spCoils.length,
          rwMt: Math.round(rwMt * 1000) / 1000,
          rwCoils: rwCoils.length,
          rejectionKg: Math.round(rejectionKgFromCoils(coils) * 10) / 10,
          scrapKg: scrapKg ?? '',
          scrapPct: scrapPct === '' ? '' : scrapPct,
          stoppageMin: review.metrics.totalStoppageMinutes,
          breakdownMin: review.metrics.totalBreakdownMinutes,
          utilizationPct: review.metrics.machineUtilizationPct,
          handoverMt: handover?.producedMt ?? '',
          openCoils: handover?.openCoilCount ?? '',
          handoverNotes: handover?.notes ?? '',
        },
        coils: exportCoils,
        stoppages: stoppageRows,
        held,
        rolls: {
          rollIn: rollingWithRoll?.rollIn || '',
          rollOut: rollingWithRoll?.rollOut || '',
          rollsIn: skinWithRoll?.rollIn || '',
          rollsOut: skinWithRoll?.rollOut || '',
          coolantTemp: review.readings?.coolantTempDegC ?? '',
          coolantPress: review.readings?.coolantPressKgCm2 ?? '',
        },
        stoppageCodes,
        defectCodes,
      });
    }

    return result;
  },
};
