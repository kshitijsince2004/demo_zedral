import { db } from '../../db';
import type { AuthUser } from '../../services/authService';
import { ProcessStationService } from '../../services/ProcessStationService';
import type { ExportFormat, ReportExecutionResult } from '../types';
import type { ReportDefinition } from './ReportDefinition';
import { currentPlantDate } from '../../utils/dateOnly';
import { buildAnnChargeReportWorkbook } from '../render/AnnChargeReportWorkbookBuilder';
import type { AnnChargeReportWorkbookInput } from '../render/AnnChargeReportWorkbookBuilder';

type AnnChargeReportScope = {
  chargeNo: string;
  baseNo?: string;
  annealingBatchNo?: string;
  dateFrom?: string;
  dateTo?: string;
};

const METRIC_KEYS = [
  'charge_temp',
  'gas_temp',
  'fc_temp',
  'base_press',
  'base_fan_rpm',
  'n2h2_flow',
  'fuel_flow',
  'rcf_rpm',
] as const;

const METRIC_LABEL: Record<(typeof METRIC_KEYS)[number], string> = {
  charge_temp: 'Charge temp',
  gas_temp: 'Gas temp',
  fc_temp: 'Base temp',
  base_press: 'Pressure',
  base_fan_rpm: 'Fan RPM',
  n2h2_flow: 'N2/H2 flow',
  fuel_flow: 'Fuel flow',
  rcf_rpm: 'RCF RPM',
};

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeStats(values: Array<number | null>) {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length === 0) return { min: null as number | null, max: null as number | null, avg: null as number | null, current: null as number | null };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const avg = finite.reduce((s, v) => s + v, 0) / finite.length;
  const current = finite[finite.length - 1] ?? null;
  return { min, max, avg, current };
}

function statusFromSpec(value: number | null, limit?: { min: number | null; max: number | null }) {
  if (value == null) return { status: '—', remarks: 'No reading' };
  if (!limit) return { status: '—', remarks: 'No spec limits configured' };
  const { min, max } = limit;
  if (min != null && value < min) return { status: 'LOW', remarks: `Expected >= ${min}` };
  if (max != null && value > max) return { status: 'HIGH', remarks: `Expected <= ${max}` };
  return { status: 'OK', remarks: 'Within spec' };
}

function parseScope(scope: Record<string, unknown>): AnnChargeReportScope {
  const chargeNo = scope.chargeNo ?? scope.charge_no ?? scope.chargeNo ?? scope.charge;
  if (!chargeNo) throw new Error('chargeNo is required');
  const baseNo = scope.baseNo ?? scope.base_no;
  const annealingBatchNo = scope.annealingBatchNo ?? scope.annealing_batch_no ?? scope.batchNo;
  return {
    chargeNo: String(chargeNo),
    baseNo: baseNo != null ? String(baseNo) : undefined,
    annealingBatchNo: annealingBatchNo != null ? String(annealingBatchNo) : undefined,
    dateFrom:
      scope.dateFrom != null
        ? String(scope.dateFrom)
        : scope.date_from != null
          ? String(scope.date_from)
          : undefined,
    dateTo:
      scope.dateTo != null
        ? String(scope.dateTo)
        : scope.date_to != null
          ? String(scope.date_to)
          : undefined,
  };
}

function parseDateMs(raw?: string): number | null {
  if (!raw) return null;
  const ms = new Date(String(raw)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function asDateValue(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export const AnnChargeReport: ReportDefinition = {
  id: 'ANN_CHARGE_REPORT',

  validateScope(scope: Record<string, unknown>) {
    parseScope(scope);
  },

  supportedFormats(): ExportFormat[] {
    return ['XLSX'];
  },

  async estimateRowCount(scope: Record<string, unknown>): Promise<number> {
    const parsed = parseScope(scope);
    const fromMs = parseDateMs(parsed.dateFrom);
    const toMs = parseDateMs(parsed.dateTo);

    let q = db.selectFrom('txn.ann_charge_reading').select((eb) => eb.fn.countAll<number>().as('n')).where('charge_no', '=', parsed.chargeNo);
    if (fromMs != null) q = q.where('taken_at', '>=', new Date(fromMs));
    if (toMs != null) q = q.where('taken_at', '<=', new Date(toMs));
    const row = await q.executeTakeFirst();
    const readingCount = Number(row?.n ?? 0);
    // Each reading expands into 8 metric parameter rows for the detailed table.
    return readingCount * METRIC_KEYS.length;
  },

  async execute(
    scope: Record<string, unknown>,
    format: ExportFormat,
    user: AuthUser,
  ): Promise<ReportExecutionResult> {
    if (!this.supportedFormats().includes(format)) {
      throw new Error(`Format ${format} not supported for ${this.id} export`);
    }

    const parsed = parseScope(scope);
    const today = currentPlantDate();

    const [detail, limits] = await Promise.all([
      ProcessStationService.getAnnChargeDetail(parsed.chargeNo),
      ProcessStationService.listAnnSpecLimits(),
    ]);
    if (!detail) throw new Error('Charge detail not found');

    const charge = detail.charge as Record<string, unknown>;
    const baseNo = parsed.baseNo ?? (charge.base_no != null ? String(charge.base_no) : '');
    const annealingBatchNo = parsed.annealingBatchNo ?? (charge.annealing_batch_no != null ? String(charge.annealing_batch_no) : '');

    const fromMs = parseDateMs(parsed.dateFrom);
    const toMs = parseDateMs(parsed.dateTo);

    const readingsAsc = [...detail.readings].sort((a: any, b: any) => String(a.taken_at).localeCompare(String(b.taken_at)));
    const readingsInWindow = readingsAsc.filter((r: any) => {
      const ms = new Date(String(r.taken_at)).getTime();
      if (!Number.isFinite(ms)) return false;
      if (fromMs != null && ms < fromMs) return false;
      if (toMs != null && ms > toMs) return false;
      return true;
    });

    const limitsByMetric = new Map<(typeof METRIC_KEYS)[number], { min: number | null; max: number | null }>();
    for (const key of METRIC_KEYS) {
      const candidates = limits.filter((l: any) => l.param_key === key);
      const row =
        candidates.find((c: any) => c.scope === 'ALL') ??
        candidates.find((c: any) => !c.scope) ??
        candidates[0];
      limitsByMetric.set(key, {
        min: row?.min_val != null ? Number(row.min_val) : null,
        max: row?.max_val != null ? Number(row.max_val) : null,
      });
    }

    const statsByMetric = new Map<(typeof METRIC_KEYS)[number], { min: number | null; max: number | null; avg: number | null; current: number | null }>();
    for (const key of METRIC_KEYS) {
      const values = readingsInWindow.map((r: any) => num((r as any)[key]));
      statsByMetric.set(key, computeStats(values));
    }

    const stagesSorted = [...detail.stages].sort((a: any, b: any) => Number(a.seq) - Number(b.seq));
    const doneCount = stagesSorted.filter((s: any) => s.end_at != null || s.skipped).length;
    const completionPct = stagesSorted.length ? Math.max(0, Math.min(100, Math.round((doneCount / stagesSorted.length) * 100))) : null;

    const stageTimeline = stagesSorted
      .filter((s: any) => s.start_at)
      .map((s: any) => {
        const startMs = new Date(String(s.start_at)).getTime();
        const endMs = s.end_at ? new Date(String(s.end_at)).getTime() : Date.now();
        return { startMs, endMs };
      });
    const cycleDurationMin = stageTimeline.length ? Math.max(0, Math.max(...stageTimeline.map((t) => t.endMs)) - Math.min(...stageTimeline.map((t) => t.startMs))) / 60000 : null;
    const cycleStart = stageTimeline.length ? Math.min(...stageTimeline.map((t) => t.startMs)) : null;
    const cycleEnd = stageTimeline.length ? Math.max(...stageTimeline.map((t) => t.endMs)) : null;

    const alarmOpenCount = detail.stoppages.filter((s: any) => s.end_at == null).length;
    const coilCount = detail.roster.length;
    const gradeCode = charge.grade_code != null ? String(charge.grade_code) : null;
    const weightMt = charge.charge_wt_mt != null ? num(charge.charge_wt_mt) : null;

    const peakChargeTemp = statsByMetric.get('charge_temp')?.max ?? null;
    const avgChargeTemp = statsByMetric.get('charge_temp')?.avg ?? null;

    const latestReading = readingsAsc.length ? readingsAsc[readingsAsc.length - 1] : null;
    const latestPressure = latestReading ? num((latestReading as any).base_press) : null;
    const latestFlow = latestReading ? num((latestReading as any).n2h2_flow) : null;

    // Build Detailed Table rows.
    const productionTableRows = readingsInWindow.flatMap((r: any) => {
      const takenAt = asDateValue(r.taken_at);
      return METRIC_KEYS.map((key) => {
        const current = num(r[key]);
        const limit = limitsByMetric.get(key);
        const spec = statusFromSpec(current, limit);
        const st = statsByMetric.get(key);
        return {
          timestamp: takenAt,
          parameter: METRIC_LABEL[key],
          currentValue: current,
          min: st?.min ?? null,
          max: st?.max ?? null,
          avg: st?.avg ?? null,
          status: spec.status,
          remarks: spec.remarks,
        };
      });
    });

    const chartsDataRows = readingsInWindow.map((r: any) => ({
      takenAt: asDateValue(r.taken_at),
      stageCode: r.stage_code ?? null,
      chargeTemp: num(r.charge_temp),
      gasTemp: num(r.gas_temp),
      fcTemp: num(r.fc_temp),
      basePress: num(r.base_press),
      baseFanRpm: num(r.base_fan_rpm),
      n2h2Flow: num(r.n2h2_flow),
      fuelFlow: num(r.fuel_flow),
      rcfRpm: num(r.rcf_rpm),
    }));

    const input: AnnChargeReportWorkbookInput = {
      companyName: 'Zedral',
      reportTitle: 'ANN Production Report',
      reportDate: today,
      generatedAt: new Date().toISOString(),
      generatedBy: user.username,
      scope: { baseNo, annealingBatchNo, chargeNo: parsed.chargeNo },
      summary: {
        status: String(charge.status ?? 'RUNNING'),
        cycleDurationMin: cycleDurationMin ?? null,
        completionPct: completionPct ?? null,
        coilCount: coilCount ?? null,
        gradeCode,
        weightMt,
        peakChargeTemp: peakChargeTemp ?? null,
        avgChargeTemp: avgChargeTemp ?? null,
        latestPressure,
        latestFlow,
        alarmOpenCount: alarmOpenCount ?? null,
        startTime: cycleStart != null ? new Date(cycleStart).toISOString() : null,
        endTime: cycleEnd != null ? new Date(cycleEnd).toISOString() : null,
      },
      chartsDataRows,
      productionTableRows,
    };

    const filename = `ann_charge_report_${parsed.chargeNo}_${today}.xlsx`;
    const result: ReportExecutionResult = {
      rows: [],
      filename,
      dataVersion: `ANN:${parsed.chargeNo}:${today}`,
      deterministic: false,
      templateBuffer: await buildAnnChargeReportWorkbook(input),
      rowCount: productionTableRows.length,
    };

    return result;
  },
};

