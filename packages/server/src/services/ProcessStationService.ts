import { z } from 'zod';
import { formatPlantTime, type JourneyStepStatus } from '@m1/shared-validation';
import { db } from '../db';
import { AutoSourceService } from './AutoSourceService';
import { ProcessRouteService } from './ProcessRouteService';
import { parseCoilIdentity } from '../utils/rwdFieldMappers';
import { ANN_BASE_REQUIRED_MSG, annCreateStatus, assertAnnBaseAssigned } from '../lib/annBaseAssignment';
import { throwVersionConflict } from '../utils/versionConflict';
import { buildAnnPlanDetailSections, type AnnDetailSection } from '../utils/annQueueOrderDetail';

/** PERF-C1: explicit columns for hot reads (no selectAll). */
const PKL_CHART_COLS = [
  'chart_id', 'shift_log_id', 'chart_time', 'tank_no', 'tank_level', 'tank_temp_degc',
  'acid_strength_pct', 'iron_strength_pct', 'steam_inlet_kgcm2', 'steam_outlet_kgcm2',
  'steam_outlet_burner_kgcm2', 'dosage_acid', 'dosage_water', 'dosage_inhibitor',
  'rinse_cl', 'rinse_ph', 'rinse_flow', 'rinse_temp_degc', 'rinse_acid_pct', 'rinse_iron_pct',
  'burner_pressure_kgcm2', 'hot_air_temp_degc', 'line_incharge',
] as const;
const PKL_SPEC_COLS = ['param_key', 'tank_scope', 'min_val', 'max_val', 'unit', 'is_active'] as const;
const PKL_CHART_CFG_COLS = ['config_id', 'interval_hours', 'reading_labels', 'reminder_mode', 'is_active'] as const;
const ANN_CHARGE_COLS = [
  'charge_no', 'base_no', 'shift_log_id', 'furnace_id', 'grade_code', 'annealing_batch_no',
  'cooling_hood_id', 'soak_temp_degc', 'soak_time_hr', 'status', 'no_of_coils', 'charge_wt_mt',
  'current_stage_code', 'dew_point_n2', 'dew_point_h2', 'temperature_degc', 'exp_unloading_time',
  'unloading_wt_mt', 'loading_mt', 'unloading_mt', 'cumm_loading_mt', 'cumm_unloading_mt',
  'total_active_min', 'total_idle_min', 'height_mm', 'tightness_drop_mmwc', 'total_h2_flow_cycle',
  'charged_condition', 'ann_cycle_code', 'oxygen_pct', 'prod_date', 'shift_code', 'created_by_user_id',
] as const;
const ANN_STAGE_COLS = [
  'stage_id', 'charge_no', 'stage_code', 'seq', 'start_at', 'end_at', 'duration_min',
  'skipped', 'skip_authorized_by', 'skip_reason', 'started_by_user_id', 'transition_temp_degc',
] as const;
const ANN_READING_COLS = [
  'reading_id', 'charge_no', 'base_no', 'stage_code', 'shift_code', 'operator_user_id',
  'taken_at', 'charge_temp', 'gas_temp', 'fc_temp', 'n2h2_flow', 'base_press',
  'base_fan_rpm', 'fuel_flow', 'rcf_rpm',
] as const;
const ANN_STOPPAGE_COLS = [
  'stoppage_id', 'charge_no', 'base_no', 'category_code', 'start_at', 'end_at',
  'duration_min', 'reason', 'remark',
] as const;

export type ProcessStationCode = 'HRS' | 'PKL' | 'ANN' | 'RWD' | 'CRS' | 'CTL';

/** PERF-C2: in-memory page when limit set; full list otherwise (exports / legacy). */
// ponytail: journey queue is small enough that DB cursor isn't worth a second code path yet
function pageProcessQueue(
  cards: ProcessQueueCard[],
  paging?: { limit?: number; cursor?: string },
): { queue: ProcessQueueCard[]; nextCursor?: string | null } {
  const limit = paging?.limit != null && paging.limit > 0
    ? Math.min(200, Math.max(1, Math.floor(paging.limit)))
    : undefined;
  if (!limit) return { queue: cards };
  let start = 0;
  if (paging?.cursor) {
    const idx = cards.findIndex((c) => c.journeyId === paging.cursor || c.coilNo === paging.cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const page = cards.slice(start, start + limit);
  const nextCursor = start + limit < cards.length && page.length > 0
    ? (page[page.length - 1].journeyId || page[page.length - 1].coilNo)
    : null;
  return { queue: page, nextCursor };
}

/** Plan Annealing Batch from ppc_batch.raw_row_json (ANN import extras). */
function planAnnealingBatchFromRaw(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'object' && !Array.isArray(raw)) obj = raw as Record<string, unknown>;
  else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  if (!obj) return undefined;
  const v = obj.annealingBatch ?? obj.annealing_batch;
  const s = v != null ? String(v).trim() : '';
  return s || undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export interface ProcessQueueCard {
  coilNo: string;
  displayCoilNo?: string;
  gradeCode: string;
  customerName: string;
  widthMm?: number;
  thicknessMm?: number;
  weightMt?: number;
  status: 'PENDING' | 'PREPARING' | 'IN_PROGRESS' | 'STOPPAGE' | 'HOLD' | 'REJECTED' | 'COMPLETED';
  journeyId: string;
  stepNo: number;
  batchNumber?: string;
  /** ANN plan Annealing Batch (raw_row_json) — MH create default when body omits. */
  annealingBatch?: string;
  /** PKL sibling key */
  motherCoilNo?: string;
  slitId?: string;
  /** Pass: number of order-lines on this mother coil */
  lineCount?: number;
  /** HRS combination display e.g. 483+483+536 */
  combination?: string;
  /** Pass order-lines from ppc_batch */
  orderLines?: Array<{
    batchNumber?: string;
    widthMm?: number;
    weightMt?: number;
    thicknessMm?: number;
    finishThicknessMm?: number;
    customerName?: string;
    routeRaw?: string;
    slitId?: string;
    surfaceFinish?: string;
    toWorkCenter?: string;
    suggestedMachine?: string;
  }>;
  prefill?: Awaited<ReturnType<typeof AutoSourceService.resolvePrefill>>;
}

export interface CrsShiftMetrics {
  totalProdMt: number;
  forCtlMt: number;
  holdMt: number;
  coilShipMt: number;
  rejectionOdMt: number;
  rejectionIdMt: number;
  scrapPct: number;
  settingCount: number;
}

export interface HrsShiftMetrics {
  targetMt: number;
  totalProdMt: number;
  scrapMt: number;
  scrapPct: number;
  coilsDone: number;
  settingCount: number;
}

export const ProcessManualCoilSchema = z.object({
  coilNo: z.string().min(1),
  gradeCode: z.string().min(1).default('NA'),
  customerName: z.string().min(1).default('Manual'),
  widthMm: z.number().positive(),
  thicknessMm: z.number().positive().default(0.1),
  weightMt: z.number().positive(),
  routeRaw: z.string().optional(),
  shiftCode: z.string().default('A'),
  // PKL order fields (revamp §4) — optional for other lines
  motherCoilNo: z.string().optional(),
  slitId: z.string().optional(),
  surface: z.string().optional(),
  heatNo: z.string().optional(),
  source: z.string().optional(),
  planDate: z.string().optional(),
});

const DEFAULT_ROUTES: Record<ProcessStationCode, string> = {
  HRS: 'S-P-4-R-F-C-LE-PKG', PKL: 'P-4-R-F-C-LE-PKG', ANN: 'F-X-C-LE-PKG',
  RWD: 'R-F-C-LE-PKG', CRS: 'C-LE-PKG', CTL: 'LE-PKG',
};

const PROCESS_ROUTE_CODE: Record<ProcessStationCode, string> = {
  HRS: 'S', PKL: 'P', ANN: 'F', RWD: 'R', CRS: 'C', CTL: 'LE',
};

function mapStepStatus(status: string, journeyStatus: string): ProcessQueueCard['status'] {
  if (journeyStatus === 'HOLD') return 'HOLD';
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'ACTIVE') return 'IN_PROGRESS';
  return 'PENDING';
}

export class ProcessStationService {
  static assertProcessCode(raw: string): ProcessStationCode {
    const code = raw.toUpperCase();
    if (!['HRS', 'PKL', 'ANN', 'RWD', 'CRS', 'CTL'].includes(code)) throw new Error('Unknown process station: ' + raw);
    return code as ProcessStationCode;
  }

  static async getQueue(
    processCode: string,
    _userId?: number,
    paging?: { limit?: number; cursor?: string },
  ): Promise<{ queue: ProcessQueueCard[]; nextCursor?: string | null }> {
    const code = this.assertProcessCode(processCode);
    // RWD is its own order line (txn.rwd_order) — do not use journey station queue.
    if (code === 'RWD') {
      const { RewindingOrderService } = await import('./RewindingOrderService');
      const { queue } = await RewindingOrderService.getQueue('RWD');
      const mapped = queue.map((c) => {
        const raw = (c.status ?? 'PENDING').toUpperCase();
        const status: ProcessQueueCard['status'] =
          raw === 'COMPLETED' ? 'COMPLETED'
            : raw === 'REJECTED' ? 'REJECTED'
              : raw === 'STOPPAGE' ? 'STOPPAGE'
                : raw === 'IN_PROGRESS' ? 'IN_PROGRESS'
                  : raw === 'PREPARING' ? 'PREPARING'
                    : 'PENDING';
        return {
          coilNo: c.coilNo,
          displayCoilNo: c.displayCoilNo,
          gradeCode: c.gradeCode,
          customerName: c.customerName,
          widthMm: c.widthMm,
          thicknessMm: c.thicknessMm,
          weightMt: c.weightMt,
          status,
          journeyId: c.batchNumber,
          stepNo: 0,
          batchNumber: c.batchNumber,
          slitId: c.slitId,
        } satisfies ProcessQueueCard;
      });
      return pageProcessQueue(mapped, paging);
    }

    // HRS/PKL queues live on /hrs-order/queue & /pkl-order/queue — stations queue is ANN/CRS/CTL.
    if (code === 'HRS' || code === 'PKL') {
      throw new Error(`Use /${code.toLowerCase()}-order/queue (stations queue is for ANN/CRS/CTL)`);
    }

    const rows = await db.selectFrom('planning.order_journey as oj')
      .innerJoin('planning.order_journey_step as ojs', (join) => join.onRef('ojs.journey_id', '=', 'oj.journey_id').onRef('ojs.step_no', '=', 'oj.current_step_no'))
      .innerJoin('coil.coil as c', 'c.coil_no', 'oj.coil_no')
      .leftJoin('master.customer as cu', 'c.customer_id', 'cu.customer_id')
      .leftJoin('planning.ppc_batch as pb', 'pb.batch_id', 'ojs.queue_batch_id')
      .select([
        'oj.journey_id', 'oj.coil_no', 'oj.status as journey_status', 'ojs.step_no', 'ojs.status as step_status',
        'c.grade_code', 'c.nominal_width_mm', 'c.coil_width_mm', 'c.coil_thk_mm', 'c.weight_mt',
        'cu.customer_name as customer_name', 'pb.batch_number', 'pb.slit_id', 'pb.raw_row_json',
      ])
      .where('oj.status', 'in', ['ACTIVE', 'HOLD']).where('ojs.process_code', '=', code).where('ojs.status', 'in', ['PENDING', 'ACTIVE', 'HOLD'])
      .orderBy('ojs.started_at', 'asc').orderBy('oj.journey_id', 'asc').execute();
    const cards: ProcessQueueCard[] = [];
    for (const row of rows) {
      const prefill = await AutoSourceService.resolvePrefill(code, row.coil_no);
      // Prefill-first so queue card values match the capture workspace (§4).
      const card: ProcessQueueCard = {
        coilNo: row.coil_no,
        displayCoilNo: prefill.displayCoilNo ?? row.coil_no,
        gradeCode: prefill.gradeCode?.value ?? row.grade_code ?? '-',
        customerName: prefill.customerName?.value ?? row.customer_name ?? '-',
        widthMm: toOptionalNumber(prefill.widthMm?.value ?? row.nominal_width_mm ?? row.coil_width_mm),
        thicknessMm: toOptionalNumber(prefill.thicknessMm?.value ?? row.coil_thk_mm),
        weightMt: toOptionalNumber(prefill.weightMt?.value ?? row.weight_mt),
        status: mapStepStatus(row.step_status, row.journey_status),
        journeyId: String(row.journey_id),
        stepNo: row.step_no,
        batchNumber: prefill.batchNumber?.value ?? row.batch_number ?? undefined,
        slitId: row.slit_id ? String(row.slit_id) : undefined,
        annealingBatch: planAnnealingBatchFromRaw(row.raw_row_json),
        prefill,
      };

      if (code === 'CRS') {
        const lines = await db.selectFrom('planning.ppc_batch')
          .select([
            'batch_number', 'width_mm', 'customer_name', 'process_route_raw',
            'machine_code', 'slit_id', 'ppc_weight_mt', 'finish_thk_mm',
            'input_thk_mm', 'to_work_center', 'roll_finish',
          ])
          .where('coil_no', '=', row.coil_no)
          .where((eb) => eb.or([
            eb('machine_code', 'like', 'CRS%'),
            eb('sub_process', '=', 'CRS'),
            eb('from_work_center', 'in', ['C', 'CRS']),
          ]))
          .orderBy('slit_id', 'asc')
          .orderBy('batch_number', 'asc')
          .execute();
        card.orderLines = lines.map((l) => ({
          batchNumber: l.batch_number ?? undefined,
          widthMm: l.width_mm != null ? Number(l.width_mm) : undefined,
          weightMt: l.ppc_weight_mt != null ? Number(l.ppc_weight_mt) : undefined,
          thicknessMm: l.input_thk_mm != null ? Number(l.input_thk_mm) : undefined,
          finishThicknessMm: l.finish_thk_mm != null ? Number(l.finish_thk_mm) : undefined,
          customerName: l.customer_name ?? undefined,
          routeRaw: l.process_route_raw ?? undefined,
          slitId: l.slit_id ?? undefined,
          surfaceFinish: l.roll_finish ?? undefined,
          toWorkCenter: l.to_work_center ?? undefined,
          suggestedMachine: l.machine_code?.startsWith('CRS') ? l.machine_code : undefined,
        }));
        card.lineCount = Math.max(1, card.orderLines.length);
      }

      cards.push(card);
    }

    if (code === 'ANN') {
      const chargedRows = await db.selectFrom('txn.ann_charge_coil as acc')
        .innerJoin('txn.ann_charge as ac', 'ac.charge_no', 'acc.charge_no')
        .select('acc.coil_no')
        .where('ac.status', '!=', 'DONE')
        .execute();
      const charged = new Set(chargedRows.map((r) => r.coil_no));
      const waiting = cards
        .filter((c) => !charged.has(c.coilNo))
        .map((c) => (
          c.status === 'IN_PROGRESS' || c.status === 'PREPARING'
            ? { ...c, status: 'PENDING' as const }
            : c
        ));
      const have = new Set(waiting.map((c) => c.coilNo));
      const planned = await db.selectFrom('planning.ppc_batch as pb')
        .select([
          'pb.batch_id', 'pb.batch_number', 'pb.coil_no', 'pb.customer_name',
          'pb.grade_code', 'pb.width_mm', 'pb.input_thk_mm', 'pb.ppc_thk_mm', 'pb.ppc_weight_mt',
          'pb.slit_id', 'pb.raw_row_json',
        ])
        .where((eb) => eb.or([
          eb('pb.machine_code', '=', 'ANN'),
          eb('pb.sub_process', '=', 'ANN'),
          eb('pb.from_work_center', 'in', ['F', 'ANN']),
        ]))
        .orderBy('pb.plan_date', 'desc')
        .limit(500)
        .execute();
      for (const row of planned) {
        if (charged.has(row.coil_no) || have.has(row.coil_no)) continue;
        have.add(row.coil_no);
        waiting.push({
          coilNo: row.coil_no,
          displayCoilNo: row.coil_no,
          gradeCode: row.grade_code || '-',
          customerName: row.customer_name || '-',
          widthMm: row.width_mm != null ? Number(row.width_mm) : undefined,
          thicknessMm: row.input_thk_mm != null
            ? Number(row.input_thk_mm)
            : row.ppc_thk_mm != null
              ? Number(row.ppc_thk_mm)
              : undefined,
          weightMt: row.ppc_weight_mt != null ? Number(row.ppc_weight_mt) : undefined,
          status: 'PENDING',
          journeyId: `plan:${row.batch_id}`,
          stepNo: 0,
          batchNumber: row.batch_number ?? undefined,
          slitId: row.slit_id ? String(row.slit_id) : undefined,
          annealingBatch: planAnnealingBatchFromRaw(row.raw_row_json),
        });
      }
      return pageProcessQueue(waiting, paging);
    }

    return pageProcessQueue(cards, paging);
  }

  static async getCrsShiftMetrics(shiftLogId: string): Promise<CrsShiftMetrics> {
    const rows = await db.selectFrom('txn.prod_crs')
      .select([
        'output_wt_mt',
        'for_ctl_mt',
        'hold_mt',
        'rejection_od_mt',
        'rejection_id_mt',
        'scrap_mt',
        'input_wt_mt',
        'setting_count',
      ])
      .where('shift_log_id', '=', shiftLogId)
      .execute();

    let totalProdMt = 0;
    let forCtlMt = 0;
    let holdMt = 0;
    let rejectionOdMt = 0;
    let rejectionIdMt = 0;
    let scrapMt = 0;
    let inputWtMt = 0;
    let settingCount = 0;

    for (const r of rows) {
      totalProdMt += Number(r.output_wt_mt ?? 0);
      forCtlMt += Number(r.for_ctl_mt ?? 0);
      holdMt += Number(r.hold_mt ?? 0);
      rejectionOdMt += Number(r.rejection_od_mt ?? 0);
      rejectionIdMt += Number(r.rejection_id_mt ?? 0);
      scrapMt += Number(r.scrap_mt ?? 0);
      inputWtMt += Number(r.input_wt_mt ?? 0);
      settingCount += Number(r.setting_count ?? 0);
    }

    const coilShipMt = Math.max(0, totalProdMt - forCtlMt - holdMt);
    const scrapPct = inputWtMt > 0 ? Math.round((scrapMt / inputWtMt) * 10000) / 100 : 0;

    return {
      totalProdMt,
      forCtlMt,
      holdMt,
      coilShipMt,
      rejectionOdMt,
      rejectionIdMt,
      scrapPct,
      settingCount,
    };
  }

  static async getHrsShiftMetrics(shiftLogId: string): Promise<HrsShiftMetrics> {
    const rows = await db.selectFrom('txn.prod_hrs')
      .select(['weight_mt', 'scrap_mt', 'mother_coil_weight_mt', 'setting_count', 'entry_id'])
      .where('shift_log_id', '=', shiftLogId)
      .execute();

    let totalProdMt = 0;
    let scrapMt = 0;
    let motherWt = 0;
    let settingCount = 0;
    for (const r of rows) {
      totalProdMt += Number(r.weight_mt ?? 0);
      scrapMt += Number(r.scrap_mt ?? 0);
      motherWt += Number(r.mother_coil_weight_mt ?? r.weight_mt ?? 0);
      settingCount += Number(r.setting_count ?? 0);
    }
    const scrapPct = motherWt > 0 ? Math.round((scrapMt / motherWt) * 10000) / 100 : 0;
    return {
      targetMt: motherWt,
      totalProdMt,
      scrapMt,
      scrapPct,
      coilsDone: rows.length,
      settingCount,
    };
  }

  static async listCrsAssignmentBoard() {
    const rows = await db.selectFrom('planning.ppc_batch')
      .select([
        'batch_id',
        'batch_number',
        'coil_no',
        'customer_name',
        'grade_code',
        'width_mm',
        'ppc_thk_mm',
        'input_thk_mm',
        'ppc_weight_mt',
        'machine_code',
        'process_route_raw',
        'slit_id',
      ])
      .where((eb) => eb.or([
        eb('machine_code', 'like', 'CRS%'),
        eb('sub_process', '=', 'CRS'),
        eb('from_work_center', 'in', ['C', 'CRS']),
      ]))
      .orderBy('coil_no')
      .orderBy('batch_number')
      .limit(500)
      .execute();

    return rows.map((r) => ({
      batchId: String(r.batch_id),
      batchNumber: r.batch_number,
      coilNo: r.coil_no,
      customerName: r.customer_name,
      gradeCode: r.grade_code,
      widthMm: r.width_mm != null ? Number(r.width_mm) : null,
      thicknessMm: r.ppc_thk_mm != null ? Number(r.ppc_thk_mm) : (r.input_thk_mm != null ? Number(r.input_thk_mm) : null),
      weightMt: r.ppc_weight_mt != null ? Number(r.ppc_weight_mt) : null,
      suggestedMachine: r.machine_code?.startsWith('CRS') ? r.machine_code : null,
      routeRaw: r.process_route_raw,
      slitId: r.slit_id,
    }));
  }

  static async assignCrsMachine(batchId: string, machineCode: string, overrideReason?: string) {
    const code = machineCode.toUpperCase();
    if (!/^CRS[1-6]$/.test(code)) throw new Error('machineCode must be CRS1–CRS6');
    const batch = await db.selectFrom('planning.ppc_batch')
      .select(['width_mm', 'ppc_thk_mm', 'ppc_weight_mt', 'machine_code', 'batch_number'])
      .where('batch_id', '=', batchId)
      .executeTakeFirst();
    if (!batch) throw new Error('Batch not found');

    const current = (batch.machine_code ?? '').toUpperCase();
    // PERF-E3: already on this CRS = idempotent; other CRS claim = 409.
    if (/^CRS[1-6]$/.test(current) && current === code) {
      return { ok: true, eligibility: { hardBlocked: false, overrideRequired: false, warnings: [] as string[] } };
    }
    if (/^CRS[1-6]$/.test(current) && current !== code) {
      throwVersionConflict({
        batchId,
        batchNumber: batch.batch_number,
        machineCode: current,
      });
    }

    const { MachineSpecService } = await import('./MachineSpecService');
    const { isEligible } = await import('../utils/machineEligibility');
    const spec = await MachineSpecService.getActive(code);
    const result = isEligible({
      widthMm: batch.width_mm != null ? Number(batch.width_mm) : null,
      thicknessMm: batch.ppc_thk_mm != null ? Number(batch.ppc_thk_mm) : null,
      coilWeightMt: batch.ppc_weight_mt != null ? Number(batch.ppc_weight_mt) : null,
      suggestedMachine: batch.machine_code,
    }, spec);

    if (result.hardBlocked) {
      throw new Error(`Hard block: ${result.warnings.join('; ')}`);
    }
    if (result.overrideRequired && !overrideReason?.trim()) {
      throw new Error(`Override reason required: ${result.warnings.join('; ')}`);
    }

    // CAS on prior machine_code (ppc_batch has no updated_at).
    const upd = await db.updateTable('planning.ppc_batch')
      .set({ machine_code: code })
      .where('batch_id', '=', batchId)
      .where('machine_code', '=', batch.machine_code)
      .executeTakeFirst();
    if (Number(upd.numUpdatedRows ?? 0) === 0) {
      const cur = await db.selectFrom('planning.ppc_batch')
        .select(['machine_code', 'batch_number'])
        .where('batch_id', '=', batchId)
        .executeTakeFirst();
      const curCode = (cur?.machine_code ?? '').toUpperCase();
      if (curCode === code) return { ok: true, eligibility: result };
      throwVersionConflict({
        batchId,
        batchNumber: cur?.batch_number ?? batch.batch_number,
        machineCode: cur?.machine_code ?? null,
      });
    }

    return { ok: true, eligibility: result };
  }

  static async getEntryPrefill(processCode: string, coilNo: string) {
    const code = this.assertProcessCode(processCode);
    const prefill = await AutoSourceService.resolvePrefill(processCode, coilNo);
    // HRS capture needs every plan slit under the mother — attach orderLines.
    if (code === 'HRS') {
      const { HrsOrderService } = await import('./HrsOrderService');
      const [orderLines, hrsCapture] = await Promise.all([
        HrsOrderService.loadOrderLines(coilNo),
        this.loadHrsCaptureSnapshot(coilNo),
      ]);
      return { ...prefill, orderLines, hrsCapture };
    }
    if (code === 'PKL') {
      const pklCapture = await this.loadPklCaptureSnapshot(coilNo);
      return { ...prefill, pklCapture };
    }
    return prefill;
  }

  /** Latest saved prod_pkl for completed (or in-progress) view. */
  private static async loadPklCaptureSnapshot(coilNo: string) {
    const select = [
      'weight_mt', 'ppc_weight_mt', 'line_speed_mpm', 'wp', 'end_filling', 'remarks',
    ] as const;

    let header = await db.selectFrom('txn.prod_pkl')
      .select(select)
      .where('coil_no', '=', coilNo)
      .orderBy('entry_id', 'desc')
      .executeTakeFirst();

    if (!header) {
      const identity = parseCoilIdentity(coilNo);
      if (identity.slitId && identity.coilNo !== coilNo) {
        header = await db.selectFrom('txn.prod_pkl')
          .select(select)
          .where((eb) => eb.or([
            eb.and([
              eb('mother_coil_no', '=', identity.coilNo),
              eb('slit_id', '=', identity.slitId),
            ]),
            eb.and([
              eb('coil_no', '=', identity.coilNo),
              eb('slit_id', '=', identity.slitId),
            ]),
          ]))
          .orderBy('entry_id', 'desc')
          .executeTakeFirst();
      }
    }
    if (!header) return null;

    const wp = header.wp === 'W' || header.wp === 'P' ? header.wp : undefined;
    return {
      weightMt: header.weight_mt != null ? Number(header.weight_mt) : undefined,
      ppcWeightMt: header.ppc_weight_mt != null ? Number(header.ppc_weight_mt) : undefined,
      lineSpeedMpm: header.line_speed_mpm != null ? Number(header.line_speed_mpm) : undefined,
      wp,
      endFilling: header.end_filling ?? undefined,
      remarks: header.remarks ?? undefined,
    };
  }

  /** Latest saved prod_hrs + width / slit readings for completed (or in-progress) view. */
  private static async loadHrsCaptureSnapshot(coilNo: string) {
    const header = await db.selectFrom('txn.prod_hrs')
      .select(['entry_id', 'actual_width_mm', 'scrap_mt', 'weight_mt'])
      .where('coil_no', '=', coilNo)
      .orderBy('entry_id', 'desc')
      .executeTakeFirst();
    if (!header) return null;

    const entryId = header.entry_id;
    const [widths, slits, readings] = await Promise.all([
      db.selectFrom('txn.prod_hrs_width_reading')
        .select(['reading_time', 'actual_width_mm'])
        .where('entry_id', '=', entryId)
        .orderBy('reading_time', 'asc')
        .execute(),
      db.selectFrom('txn.prod_hrs_slit')
        .select([
          'slot', 'target_width_mm', 'planned_thk_mm', 'planned_weight_mt',
          'child_coil_no', 'customer', 'sap_batch_number', 'surface_finish',
          'finish_thickness_mm', 'route_raw', 'downstream_crs_combination',
          'hold_flag', 'for_ctl_flag', 'thk_latest_mm', 'taper_latest',
        ])
        .where('entry_id', '=', entryId)
        .orderBy('slot', 'asc')
        .execute(),
      db.selectFrom('txn.prod_hrs_slit_reading')
        .select(['slot', 'reading_time', 'thk_mm', 'taper'])
        .where('entry_id', '=', entryId)
        .orderBy('reading_time', 'asc')
        .execute(),
    ]);

    const bySlot = new Map<string, {
      thicknessReadings: { time: string; thkMm: number }[];
      taperReadings: { time: string; taper: string }[];
    }>();
    for (const r of readings) {
      const slot = String(r.slot);
      const bucket = bySlot.get(slot) ?? { thicknessReadings: [], taperReadings: [] };
      const time = formatPlantTime(new Date(String(r.reading_time)));
      if (r.thk_mm != null) bucket.thicknessReadings.push({ time, thkMm: Number(r.thk_mm) });
      if (r.taper) bucket.taperReadings.push({ time, taper: String(r.taper) });
      bySlot.set(slot, bucket);
    }

    return {
      entryId: String(entryId),
      actualWidthMm: header.actual_width_mm != null ? Number(header.actual_width_mm) : undefined,
      scrapMt: header.scrap_mt != null ? Number(header.scrap_mt) : undefined,
      weightMt: header.weight_mt != null ? Number(header.weight_mt) : undefined,
      motherWidthReadings: widths.map((w) => ({
        time: formatPlantTime(new Date(String(w.reading_time))),
        widthMm: Number(w.actual_width_mm),
      })),
      slitSlots: slits.map((s) => {
        const bucket = bySlot.get(s.slot) ?? { thicknessReadings: [], taperReadings: [] };
        if (!bucket.thicknessReadings.length && s.thk_latest_mm != null) {
          bucket.thicknessReadings.push({ time: '00:00', thkMm: Number(s.thk_latest_mm) });
        }
        if (!bucket.taperReadings.length && s.taper_latest) {
          bucket.taperReadings.push({ time: '00:00', taper: String(s.taper_latest) });
        }
        return {
          slot: s.slot,
          targetWidthMm: s.target_width_mm != null ? Number(s.target_width_mm) : undefined,
          plannedThkMm: s.planned_thk_mm != null ? Number(s.planned_thk_mm) : undefined,
          plannedWeightMt: s.planned_weight_mt != null ? Number(s.planned_weight_mt) : undefined,
          childCoilNo: s.child_coil_no ?? undefined,
          customer: s.customer ?? undefined,
          sapBatchNumber: s.sap_batch_number ?? undefined,
          surfaceFinish: s.surface_finish ?? undefined,
          finishThicknessMm: s.finish_thickness_mm != null ? Number(s.finish_thickness_mm) : undefined,
          routeRaw: s.route_raw ?? undefined,
          downstreamCrsCombination: s.downstream_crs_combination ?? undefined,
          holdFlag: !!s.hold_flag,
          forCtlFlag: !!s.for_ctl_flag,
          thkLatestMm: s.thk_latest_mm != null ? Number(s.thk_latest_mm) : undefined,
          taperLatest: s.taper_latest ?? undefined,
          thicknessReadings: bucket.thicknessReadings,
          taperReadings: bucket.taperReadings,
        };
      }),
    };
  }

  static async createManualCoil(processCode: string, input: z.infer<typeof ProcessManualCoilSchema>, userId?: number) {
    const code = this.assertProcessCode(processCode);
    if (code === 'RWD') {
      // RWD line uses txn.rwd_order — do not create a bare journey manual.
      if (userId == null) throw new Error('Rewinding manual order requires authenticated user');
      const data = ProcessManualCoilSchema.parse(input);
      const { RewindingOrderService } = await import('./RewindingOrderService');
      const { currentPlantDate } = await import('../utils/dateOnly');
      return RewindingOrderService.createManualBatch({
        batch_number: data.coilNo,
        plan_date: data.planDate || currentPlantDate(),
        shift_code: data.shiftCode || 'A',
        machine_code: 'RWD',
        coil_no: data.coilNo,
        slit_id: data.slitId,
        customer_name: data.customerName,
        grade_code: data.gradeCode,
        width_mm: data.widthMm,
        input_thk_mm: data.thicknessMm,
        ppc_thk_mm: data.thicknessMm,
        ppc_weight_mt: data.weightMt,
        roll_finish: data.surface,
      }, userId);
    }
    const data = ProcessManualCoilSchema.parse(input);
    const existing = await db.selectFrom('coil.coil').select('coil_no').where('coil_no', '=', data.coilNo).executeTakeFirst();
    if (!existing) {
      await db.insertInto('coil.coil').values({
        coil_no: data.coilNo,
        grade_code: data.gradeCode,
        nominal_width_mm: data.widthMm,
        coil_width_mm: data.widthMm,
        coil_thk_mm: data.thicknessMm,
        weight_mt: data.weightMt,
        status: 'PLANNED',
        parent_coil_no: data.motherCoilNo ?? null,
        heat_no: data.heatNo ?? null,
        surface_finish: data.surface ?? null,
      }).execute();
    }
    const routeRaw = (data.routeRaw ?? DEFAULT_ROUTES[code]).toUpperCase();
    const journeyId = await ProcessRouteService.createJourney(data.coilNo, routeRaw);
    const step = await db.selectFrom('planning.order_journey_step').select(['step_id','step_no']).where('journey_id', '=', String(journeyId)).where('route_code', '=', PROCESS_ROUTE_CODE[code]).executeTakeFirst();
    const planDate = data.planDate ? new Date(data.planDate) : new Date();
    const batch = await db.insertInto('planning.ppc_batch').values({
      batch_number: 'MAN-' + data.coilNo + '-' + Date.now().toString(36).toUpperCase(),
      plan_date: planDate,
      shift_code: data.shiftCode,
      machine_code: code,
      sub_process: code,
      coil_no: data.coilNo,
      customer_name: data.customerName,
      grade_code: data.gradeCode,
      width_mm: data.widthMm,
      input_thk_mm: data.thicknessMm,
      ppc_thk_mm: data.thicknessMm,
      ppc_weight_mt: data.weightMt,
      queue_seq: 1,
      process_route_raw: routeRaw,
      slit_id: data.slitId ?? null,
      roll_finish: data.surface ?? null,
      // ponytail: stash optional PKL extras the table has no columns for
      raw_row_json: (data.motherCoilNo || data.source)
        ? ({ motherCoilNo: data.motherCoilNo, source: data.source } as never)
        : null,
    }).returning('batch_id').executeTakeFirstOrThrow();
    if (step) {
      await db.updateTable('planning.order_journey').set({ current_step_no: step.step_no, updated_at: new Date() }).where('journey_id', '=', String(journeyId)).execute();
      await db.updateTable('planning.order_journey_step').set({ status: 'ACTIVE' as JourneyStepStatus, started_at: new Date(), queue_batch_id: batch.batch_id }).where('step_id', '=', step.step_id).execute();
    }
    return { coilNo: data.coilNo, batchNumber: batch.batch_id, journeyId };
  }

  /** Shift stoppage history for process Capture live (txn.stoppage by shift_log). */
  static async listShiftStoppages(processCode: string, shiftLogId: string) {
    const code = this.assertProcessCode(processCode);
    const rows = await db
      .selectFrom('txn.stoppage as os')
      .leftJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
      .select([
        'os.stoppage_id',
        'os.category_code',
        'os.breakdown_code',
        'os.start_at',
        'os.end_at',
        'os.duration_min',
        'os.remarks',
        'os.machine_code',
        'sc.label',
      ])
      .where('os.shift_log_id', '=', shiftLogId)
      .where((eb) => eb.or([
        eb('os.machine_code', '=', code),
        eb('os.machine_code', 'is', null),
      ]))
      .orderBy('os.start_at', 'desc')
      .execute();
    return rows.map((s) => {
      const startAt = s.start_at instanceof Date ? s.start_at : new Date(String(s.start_at));
      const endAt = s.end_at ? (s.end_at instanceof Date ? s.end_at : new Date(String(s.end_at))) : null;
      const durationMin = s.duration_min != null
        ? Number(s.duration_min)
        : Math.max(0, Math.round(((endAt ?? new Date()).getTime() - startAt.getTime()) / 60000));
      return {
        id: String(s.stoppage_id),
        categoryCode: s.category_code ?? s.breakdown_code ?? undefined,
        categoryLabel: s.label ?? s.breakdown_code ?? 'Stoppage',
        breakdownCode: s.breakdown_code ?? undefined,
        startAt: startAt.toISOString(),
        endAt: endAt?.toISOString(),
        durationMin,
        remarks: s.remarks ?? undefined,
      };
    });
  }

  /** Start / resume production — journey ACTIVE + step ACTIVE (queue shows IN_PROGRESS). */
  static async startCoil(
    processCode: string,
    coilNo: string,
    userId?: number,
    options?: { expectedUpdatedAt?: string },
  ) {
    const code = this.assertProcessCode(processCode);
    if (code === 'HRS' && userId != null) {
      const { HrsOrderService } = await import('./HrsOrderService');
      await HrsOrderService.startProduction(coilNo, userId);
    }
    if (code === 'PKL' && userId != null) {
      const { PklOrderService } = await import('./PklOrderService');
      await PklOrderService.startProduction(coilNo, userId);
    }
    if (code === 'RWD' && userId != null) {
      // coilNo may be batch_number for RWD order line — prefer batch when journey missing.
      const { RewindingOrderService } = await import('./RewindingOrderService');
      const batch = await db
        .selectFrom('planning.ppc_batch')
        .select('batch_number')
        .where('coil_no', '=', coilNo)
        .where((eb) =>
          eb.or([
            eb('machine_code', '=', 'RWD'),
            eb('machine_code', '=', '2HI'),
            eb('from_work_center', '=', 'R'),
          ]),
        )
        .orderBy('plan_date', 'desc')
        .executeTakeFirst();
      if (batch?.batch_number) {
        await RewindingOrderService.startProduction(String(batch.batch_number), userId);
        return { coilNo, status: 'IN_PROGRESS' };
      }
    }
    const row = await db.selectFrom('planning.order_journey as oj')
      .innerJoin('planning.order_journey_step as ojs', (join) =>
        join.onRef('ojs.journey_id', '=', 'oj.journey_id').onRef('ojs.step_no', '=', 'oj.current_step_no'))
      .select(['oj.journey_id', 'oj.updated_at', 'oj.status', 'ojs.step_id', 'ojs.started_at'])
      .where('oj.coil_no', '=', coilNo)
      .where('ojs.process_code', '=', code)
      .where('ojs.status', 'in', ['PENDING', 'ACTIVE', 'HOLD'])
      .executeTakeFirst();
    if (!row) {
      if (code === 'HRS' || code === 'PKL') return { coilNo, status: 'IN_PROGRESS' as const };
      throw new Error(`No active ${code} journey for ${coilNo}`);
    }
    // PERF-E2: optional updated_at CAS when client sends expectedUpdatedAt.
    let journeyUpd = db.updateTable('planning.order_journey')
      .set({ status: 'ACTIVE' as never, updated_at: new Date() })
      .where('journey_id', '=', row.journey_id);
    if (options?.expectedUpdatedAt) {
      journeyUpd = journeyUpd.where('updated_at', '=', new Date(options.expectedUpdatedAt));
    }
    const journeyResult = await journeyUpd.executeTakeFirst();
    if (options?.expectedUpdatedAt && Number(journeyResult.numUpdatedRows ?? 0) === 0) {
      const cur = await db.selectFrom('planning.order_journey')
        .select(['journey_id', 'status', 'updated_at', 'current_step_no'])
        .where('journey_id', '=', row.journey_id)
        .executeTakeFirst();
      throwVersionConflict({
        coilNo,
        journeyId: String(cur?.journey_id ?? row.journey_id),
        status: cur?.status ?? row.status,
        updatedAt: cur?.updated_at ? new Date(cur.updated_at as Date).toISOString() : null,
        currentStepNo: cur?.current_step_no ?? null,
      });
    }
    // ponytail: keep first started_at (timer durability); only stamp if missing
    await db.updateTable('planning.order_journey_step')
      .set({
        status: 'ACTIVE' as JourneyStepStatus,
        ...(row.started_at ? {} : { started_at: new Date() }),
      })
      .where('step_id', '=', row.step_id)
      .execute();
    return { coilNo, status: 'IN_PROGRESS' as const };
  }

  /** Hold journey + current step — no advance (PKL revamp §6 / plan §9). */
  static async holdCoil(
    processCode: string,
    coilNo: string,
    userId?: number,
    reason = 'HOLD',
    remarks = 'Operator hold',
    options?: { expectedUpdatedAt?: string },
  ) {
    const code = this.assertProcessCode(processCode);
    if (code === 'HRS' && userId != null) {
      const { HrsOrderService } = await import('./HrsOrderService');
      await HrsOrderService.rejectOrder(coilNo, reason, remarks, userId);
    }
    if (code === 'PKL' && userId != null) {
      const { PklOrderService } = await import('./PklOrderService');
      await PklOrderService.rejectOrder(coilNo, reason, remarks, userId);
    }
    if (code === 'RWD' && userId != null) {
      const { RewindingOrderService } = await import('./RewindingOrderService');
      const batch = await db
        .selectFrom('planning.ppc_batch')
        .select('batch_number')
        .where('coil_no', '=', coilNo)
        .where((eb) =>
          eb.or([
            eb('machine_code', '=', 'RWD'),
            eb('machine_code', '=', '2HI'),
            eb('from_work_center', '=', 'R'),
          ]),
        )
        .orderBy('plan_date', 'desc')
        .executeTakeFirst();
      if (batch?.batch_number) {
        await RewindingOrderService.rejectOrder(String(batch.batch_number), reason, remarks, userId);
        return { coilNo, status: 'HOLD' as const };
      }
    }
    const row = await db.selectFrom('planning.order_journey as oj')
      .innerJoin('planning.order_journey_step as ojs', (join) =>
        join.onRef('ojs.journey_id', '=', 'oj.journey_id').onRef('ojs.step_no', '=', 'oj.current_step_no'))
      .select(['oj.journey_id', 'oj.updated_at', 'oj.status', 'ojs.step_id'])
      .where('oj.coil_no', '=', coilNo)
      .where('ojs.process_code', '=', code)
      .executeTakeFirst();
    if (!row) {
      if (code === 'HRS' || code === 'PKL') return { coilNo, status: 'HOLD' as const };
      throw new Error(`No active ${code} journey for ${coilNo}`);
    }
    let journeyUpd = db.updateTable('planning.order_journey')
      .set({ status: 'HOLD' as never, updated_at: new Date() })
      .where('journey_id', '=', row.journey_id);
    if (options?.expectedUpdatedAt) {
      journeyUpd = journeyUpd.where('updated_at', '=', new Date(options.expectedUpdatedAt));
    }
    const journeyResult = await journeyUpd.executeTakeFirst();
    if (options?.expectedUpdatedAt && Number(journeyResult.numUpdatedRows ?? 0) === 0) {
      const cur = await db.selectFrom('planning.order_journey')
        .select(['journey_id', 'status', 'updated_at', 'current_step_no'])
        .where('journey_id', '=', row.journey_id)
        .executeTakeFirst();
      throwVersionConflict({
        coilNo,
        journeyId: String(cur?.journey_id ?? row.journey_id),
        status: cur?.status ?? row.status,
        updatedAt: cur?.updated_at ? new Date(cur.updated_at as Date).toISOString() : null,
        currentStepNo: cur?.current_step_no ?? null,
      });
    }
    await db.updateTable('planning.order_journey_step')
      .set({ status: 'HOLD' as JourneyStepStatus })
      .where('step_id', '=', row.step_id)
      .execute();
    return { coilNo, status: 'HOLD' as const };
  }

  static async getPklChart(shiftLogId: string) {
    return db.selectFrom('txn.prod_pkl_chart').select([...PKL_CHART_COLS]).where('shift_log_id', '=', shiftLogId).orderBy('chart_time', 'asc').orderBy('tank_no', 'asc').execute();
  }

  /** ponytail: line-level singletons written only on tank_no=1 (plan §2.2). */
  static async upsertPklChart(
    shiftLogId: string,
    chartTime: string,
    tanks: Array<Record<string, unknown> & { tankNo: number }>,
    line?: Record<string, unknown>,
  ) {
    for (const tank of tanks) {
      const existing = await db.selectFrom('txn.prod_pkl_chart')
        .select('chart_id')
        .where('shift_log_id', '=', shiftLogId)
        .where('chart_time', '=', chartTime)
        .where('tank_no', '=', tank.tankNo)
        .executeTakeFirst();
      const values: Record<string, unknown> = {
        shift_log_id: shiftLogId,
        chart_time: chartTime,
        tank_no: tank.tankNo,
        tank_level: tank.tankLevel ?? null,
        tank_temp_degc: tank.tankTempDegc ?? null,
        acid_strength_pct: tank.acidStrengthPct ?? null,
        iron_strength_pct: tank.ironStrengthPct ?? null,
      };
      if (tank.tankNo === 1 && line) {
        // Interval reading fields only — steam_outlet_burner / rinse_acid_pct / rinse_iron_pct
        // are end-of-shift once-per-shift values and must not be cleared here.
        Object.assign(values, {
          steam_inlet_kgcm2: line.steamInletKgcm2 ?? null,
          steam_outlet_kgcm2: line.steamOutletKgcm2 ?? null,
          dosage_acid: line.dosageAcid ?? null,
          dosage_water: line.dosageWater ?? null,
          dosage_inhibitor: line.dosageInhibitor ?? null,
          rinse_cl: line.rinseCl ?? null,
          rinse_ph: line.rinsePh ?? null,
          rinse_flow: line.rinseFlow ?? null,
          rinse_temp_degc: line.rinseTempDegc ?? null,
          burner_pressure_kgcm2: line.burnerPressureKgcm2 ?? null,
          hot_air_temp_degc: line.hotAirTempDegc ?? null,
          line_incharge: line.lineIncharge ?? null,
        });
      }
      if (existing) {
        await db.updateTable('txn.prod_pkl_chart').set(values as never).where('chart_id', '=', existing.chart_id).execute();
      } else {
        await db.insertInto('txn.prod_pkl_chart').values(values as never).execute();
      }
    }
  }

  static async getPklShiftMetrics(shiftLogId: string) {
    const rows = await db.selectFrom('txn.prod_pkl')
      .select(['weight_mt', 'line_speed_mpm', 'repeats', 'wp', 'end_filling'])
      .where('shift_log_id', '=', shiftLogId)
      .execute();
    let totalProdMt = 0;
    let speedSum = 0;
    let speedN = 0;
    let repeats = 0;
    let wpW = 0;
    let wpP = 0;
    let endFillYes = 0;
    for (const r of rows) {
      totalProdMt += Number(r.weight_mt ?? 0);
      if (r.line_speed_mpm != null) { speedSum += Number(r.line_speed_mpm); speedN += 1; }
      repeats += Number(r.repeats ?? 0);
      if (r.wp === 'W') wpW += 1;
      if (r.wp === 'P') wpP += 1;
      if (r.end_filling === true) endFillYes += 1;
    }
    const chartRows = await db.selectFrom('txn.prod_pkl_chart')
      .select('chart_time')
      .where('shift_log_id', '=', shiftLogId)
      .groupBy('chart_time')
      .execute();
    const cfg = await db.selectFrom('master.pkl_chart_config')
      .select(['interval_hours', 'reading_labels'])
      .where('is_active', '=', true)
      .executeTakeFirst();
    const labels = Array.isArray(cfg?.reading_labels)
      ? cfg!.reading_labels as string[]
      : ['1st', '3rd', '5th', '7th'];
    return {
      totalProdMt,
      coilsDone: rows.length,
      avgLineSpeed: speedN ? Math.round((speedSum / speedN) * 100) / 100 : 0,
      repeats,
      wpW,
      wpP,
      endFillYes,
      chartReadings: chartRows.length,
      chartDue: labels.length,
      intervalHours: Number(cfg?.interval_hours ?? 2),
    };
  }

  /** PKL MH shift review — metrics + chart + stoppages + crew (revamp MH-3). */
  static async getPklShiftReview(shiftLogId: string) {
    const metrics = await this.getPklShiftMetrics(shiftLogId);
    const chartRows = await this.getPklChart(shiftLogId);
    const times = [...new Set(chartRows.map((r) => String(r.chart_time)))];
    let stoppages: Array<Record<string, unknown>> = [];
    try {
      stoppages = await db.selectFrom('txn.stoppage')
        .select([
          'stoppage_id',
          'category_code',
          'breakdown_code',
          'start_at',
          'end_at',
          'duration_min',
          'remarks',
          'machine_code',
        ])
        .where('shift_log_id', '=', shiftLogId)
        .orderBy('start_at', 'asc')
        .execute() as never;
    } catch { /* soft */ }
    const { CrewService } = await import('./ancillaryServices');
    const crew = await CrewService.listByShiftLog(shiftLogId).catch(() => []);
    const lineRows = chartRows.filter((r) => Number(r.tank_no) === 1);
    return {
      shiftLogId,
      production: metrics,
      chart: {
        readingsLogged: metrics.chartReadings,
        readingsDue: metrics.chartDue,
        times,
        lineIncharge: lineRows.map((r) => ({
          chartTime: r.chart_time,
          lineIncharge: (r as { line_incharge?: string | null }).line_incharge ?? null,
        })),
      },
      stoppages,
      crew,
    };
  }

  static async listPklSpecLimits() {
    return db.selectFrom('master.pkl_spec_limit').select([...PKL_SPEC_COLS]).where('is_active', '=', true).execute();
  }

  static async upsertPklSpecLimit(row: {
    paramKey: string; tankScope: string; minVal?: number | null; maxVal?: number | null; unit?: string | null; isActive?: boolean;
  }) {
    await db.insertInto('master.pkl_spec_limit')
      .values({
        param_key: row.paramKey,
        tank_scope: row.tankScope,
        min_val: row.minVal ?? null,
        max_val: row.maxVal ?? null,
        unit: row.unit ?? null,
        is_active: row.isActive ?? true,
      } as never)
      .onConflict((oc) => oc.columns(['param_key', 'tank_scope']).doUpdateSet({
        min_val: row.minVal ?? null,
        max_val: row.maxVal ?? null,
        unit: row.unit ?? null,
        is_active: row.isActive ?? true,
      } as never))
      .execute();
  }

  static async getPklChartConfig() {
    return db.selectFrom('master.pkl_chart_config').select([...PKL_CHART_CFG_COLS]).where('is_active', '=', true).executeTakeFirst();
  }

  static async setPklChartConfig(intervalHours: number, readingLabels?: string[]) {
    const existing = await this.getPklChartConfig();
    if (existing) {
      await db.updateTable('master.pkl_chart_config')
        .set({
          interval_hours: intervalHours,
        reading_labels: (readingLabels ?? ['1st', '3rd', '5th', '7th']) as never,
        } as never)
        .where('config_id', '=', existing.config_id)
        .execute();
    } else {
      await db.insertInto('master.pkl_chart_config').values({
        interval_hours: intervalHours,
        reading_labels: (readingLabels ?? ['1st', '3rd', '5th', '7th']) as never,
        reminder_mode: 'soft',
        is_active: true,
      } as never).execute();
    }
  }

  static async getAnnQueueOrderDetail(coilNo: string) {
    let plan = await db.selectFrom('planning.ppc_batch')
      .selectAll()
      .where('coil_no', '=', coilNo)
      .where((eb) => eb.or([
        eb('machine_code', '=', 'ANN'),
        eb('sub_process', '=', 'ANN'),
        eb('from_work_center', 'in', ['F', 'ANN']),
      ]))
      .orderBy('plan_date', 'desc')
      .executeTakeFirst();

    if (!plan) {
      const { coilNo: base, slitId } = parseCoilIdentity(coilNo);
      if (slitId && base !== coilNo) {
        plan = await db.selectFrom('planning.ppc_batch')
          .selectAll()
          .where('coil_no', '=', base)
          .where('slit_id', '=', slitId)
          .where((eb) => eb.or([
            eb('machine_code', '=', 'ANN'),
            eb('sub_process', '=', 'ANN'),
            eb('from_work_center', 'in', ['F', 'ANN']),
          ]))
          .orderBy('plan_date', 'desc')
          .executeTakeFirst();
      }
    }

    const prefill = await AutoSourceService.resolvePrefill('ANN', coilNo);

    const journey = await db.selectFrom('planning.order_journey as oj')
      .innerJoin('planning.order_journey_step as ojs', (join) =>
        join.onRef('ojs.journey_id', '=', 'oj.journey_id').onRef('ojs.step_no', '=', 'oj.current_step_no'))
      .select(['oj.status as journey_status', 'ojs.status as step_status', 'ojs.process_code', 'ojs.step_no'])
      .where('oj.coil_no', '=', coilNo)
      .where('ojs.process_code', '=', 'ANN')
      .executeTakeFirst();

    const priorRwd = await db.selectFrom('txn.prod_rwd')
      .select(['width_mm', 'output_thk_mm', 'weight_mt', 'surface_finish', 'remarks'])
      .where('coil_no', '=', coilNo)
      .orderBy('entry_id', 'desc')
      .executeTakeFirst();

    const activeCharge = await db.selectFrom('txn.ann_charge_coil as acc')
      .innerJoin('txn.ann_charge as ac', 'ac.charge_no', 'acc.charge_no')
      .select([
        'ac.charge_no', 'ac.annealing_batch_no', 'ac.base_no', 'ac.status',
        'ac.soak_temp_degc', 'ac.soak_time_hr', 'ac.ann_cycle_code', 'ac.current_stage_code',
        'acc.seq_no',
      ])
      .where('acc.coil_no', '=', coilNo)
      .where('ac.status', '!=', 'DONE')
      .orderBy('ac.charge_no', 'desc')
      .executeTakeFirst();

    let rawRow: Record<string, unknown> | null = null;
    if (plan?.raw_row_json != null) {
      const raw = plan.raw_row_json;
      if (typeof raw === 'object' && !Array.isArray(raw)) rawRow = raw as Record<string, unknown>;
      else if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            rawRow = parsed as Record<string, unknown>;
          }
        } catch { /* ignore */ }
      }
    }

    const sections: AnnDetailSection[] = buildAnnPlanDetailSections(
      plan as Record<string, unknown> | null,
      rawRow,
    );

    if (journey) {
      sections.push({
        id: 'journey',
        title: 'Journey',
        fields: [
          { label: 'Journey status', value: String(journey.journey_status ?? '—') },
          { label: 'Step status', value: String(journey.step_status ?? '—') },
          { label: 'Process', value: String(journey.process_code ?? 'ANN') },
          { label: 'Step no', value: String(journey.step_no ?? '—'), mono: true },
        ],
      });
    }

    if (priorRwd) {
      const priorFields = [
        priorRwd.width_mm != null ? { label: 'Prior width (mm)', value: String(priorRwd.width_mm), mono: true } : null,
        priorRwd.output_thk_mm != null ? { label: 'Prior output thk (mm)', value: String(priorRwd.output_thk_mm), mono: true } : null,
        priorRwd.weight_mt != null ? { label: 'Prior weight (MT)', value: String(Number(priorRwd.weight_mt)), mono: true } : null,
        priorRwd.surface_finish ? { label: 'Surface finish', value: String(priorRwd.surface_finish) } : null,
        priorRwd.remarks ? { label: 'Remarks', value: String(priorRwd.remarks) } : null,
      ].filter(Boolean) as AnnDetailSection['fields'];
      if (priorFields.length) {
        sections.push({ id: 'priorRwd', title: 'Prior rewinding', fields: priorFields });
      }
    }

    if (activeCharge) {
      const chargeFields = [
        { label: 'Charge no', value: String(activeCharge.charge_no), mono: true },
        activeCharge.annealing_batch_no
          ? { label: 'Annealing batch', value: String(activeCharge.annealing_batch_no), mono: true }
          : null,
        activeCharge.base_no ? { label: 'Base', value: String(activeCharge.base_no), mono: true } : null,
        { label: 'Charge status', value: String(activeCharge.status) },
        activeCharge.current_stage_code
          ? { label: 'Current stage', value: String(activeCharge.current_stage_code), mono: true }
          : null,
        activeCharge.soak_temp_degc != null
          ? { label: 'Soak temp (°C)', value: String(activeCharge.soak_temp_degc), mono: true }
          : null,
        activeCharge.soak_time_hr != null
          ? { label: 'Soak time (hr)', value: String(activeCharge.soak_time_hr), mono: true }
          : null,
        activeCharge.ann_cycle_code
          ? { label: 'ANN cycle code', value: String(activeCharge.ann_cycle_code), mono: true }
          : null,
        activeCharge.seq_no != null
          ? { label: 'Stack seq', value: String(activeCharge.seq_no), mono: true }
          : null,
      ].filter(Boolean) as AnnDetailSection['fields'];
      sections.push({ id: 'charge', title: 'Active charge', fields: chargeFields });
    }

    return {
      coilNo,
      displayCoilNo: prefill.displayCoilNo ?? coilNo,
      status: journey?.step_status ?? (activeCharge ? activeCharge.status : 'PENDING'),
      sections,
    };
  }

  static async getAnnCharges() {
    return db.selectFrom('txn.ann_charge').select([...ANN_CHARGE_COLS]).orderBy('charge_no', 'desc').execute();
  }

  static async getAnnChargeDetail(chargeNo: string) {
    const charge = await db.selectFrom('txn.ann_charge').select([...ANN_CHARGE_COLS]).where('charge_no', '=', chargeNo).executeTakeFirst();
    if (!charge) return null;
    const roster = await db.selectFrom('txn.ann_charge_coil as acc')
      .innerJoin('coil.coil as c', 'c.coil_no', 'acc.coil_no')
      .select(['acc.coil_no', 'acc.seq_no', 'acc.disposition', 'acc.unload_remark', 'c.grade_code', 'c.weight_mt'])
      .where('acc.charge_no', '=', chargeNo)
      .orderBy('acc.seq_no', 'asc')
      .execute();
    let stages = await db.selectFrom('txn.ann_charge_stage').select([...ANN_STAGE_COLS]).where('charge_no', '=', chargeNo).orderBy('seq', 'asc').execute();
    // ponytail: backfill stages for open in-process charges only (not PREPARING)
    if (stages.length === 0 && charge.status !== 'DONE' && charge.status !== 'PREPARING') {
      await this.seedAnnStages(chargeNo);
      stages = await db.selectFrom('txn.ann_charge_stage').select([...ANN_STAGE_COLS]).where('charge_no', '=', chargeNo).orderBy('seq', 'asc').execute();
    }
    const readings = await db.selectFrom('txn.ann_charge_reading').select([...ANN_READING_COLS]).where('charge_no', '=', chargeNo).orderBy('taken_at', 'desc').execute();
    const stoppages = await db.selectFrom('txn.ann_charge_stoppage').select([...ANN_STOPPAGE_COLS]).where('charge_no', '=', chargeNo).orderBy('start_at', 'desc').execute();
    return { charge, roster, stages, readings, stoppages };
  }

  static async createAnnCharge(input: {
    chargeNo: string; baseNo?: string; shiftLogId: string; furnaceId?: number; gradeCode?: string;
    annealingBatchNo?: string; coolingHoodId?: number; soakTempDegc?: number; soakTimeHr?: number;
    coils?: Array<{ coilNo: string; seqNo?: number }>;
  }) {
    const baseNo = input.baseNo?.trim() ? input.baseNo.trim().toUpperCase() : null;
    if (baseNo) await this.assertAnnBaseAvailable(baseNo);
    const status = annCreateStatus(baseNo);
    let annealingBatchNo = input.annealingBatchNo?.trim() || null;
    // Plan Annealing Batch from first coil when MH omits / leaves blank (override stays typed value).
    if (!annealingBatchNo && input.coils?.length) {
      const firstCoil = input.coils[0]?.coilNo;
      if (firstCoil) {
        const plan = await db.selectFrom('planning.ppc_batch')
          .select(['raw_row_json'])
          .where('coil_no', '=', firstCoil)
          .where((eb) => eb.or([
            eb('machine_code', '=', 'ANN'),
            eb('sub_process', '=', 'ANN'),
            eb('from_work_center', 'in', ['F', 'ANN']),
          ]))
          .orderBy('plan_date', 'desc')
          .executeTakeFirst();
        annealingBatchNo = planAnnealingBatchFromRaw(plan?.raw_row_json) ?? null;
      }
    }
    await db.insertInto('txn.ann_charge').values({
      charge_no: input.chargeNo,
      base_no: baseNo,
      shift_log_id: input.shiftLogId,
      furnace_id: input.furnaceId ?? null,
      grade_code: input.gradeCode ?? null,
      annealing_batch_no: annealingBatchNo,
      cooling_hood_id: input.coolingHoodId ?? null,
      soak_temp_degc: input.soakTempDegc ?? null,
      soak_time_hr: input.soakTimeHr ?? null,
      status,
      no_of_coils: 0,
      charge_wt_mt: 0,
    } as never).execute();
    if (status === 'IN_PROCESS') await this.seedAnnStages(input.chargeNo);
    if (input.coils?.length) {
      for (const c of input.coils) await this.rosterAnnCoil(input.chargeNo, c.coilNo, c.seqNo);
    }
    return input.chargeNo;
  }

  static async listVacantAnnBases(exceptChargeNo?: string) {
    const bases = await this.listAnnBases();
    const occupied = await db.selectFrom('txn.ann_charge')
      .select(['base_no', 'charge_no'])
      .where('base_no', 'is not', null)
      .where('status', '!=', 'DONE')
      .execute();
    const taken = new Set(
      occupied
        .filter((r) => r.charge_no !== exceptChargeNo)
        .map((r) => String(r.base_no)),
    );
    return bases.filter((b) => !taken.has(b.base_no));
  }

  private static async assertAnnBaseAvailable(baseNo: string, exceptChargeNo?: string) {
    const base = await db.selectFrom('master.ann_base')
      .select('base_no')
      .where('base_no', '=', baseNo)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!base) throw new Error(`Base ${baseNo} is not a valid ANN base`);
    const occ = await db.selectFrom('txn.ann_charge')
      .select('charge_no')
      .where('base_no', '=', baseNo)
      .where('status', '!=', 'DONE')
      .executeTakeFirst();
    if (occ && occ.charge_no !== exceptChargeNo) {
      throw new Error(`Base ${baseNo} is occupied by charge ${occ.charge_no}`);
    }
  }

  static async assignAnnBase(chargeNo: string, baseNoRaw: string, userId?: number) {
    const baseNo = assertAnnBaseAssigned(baseNoRaw);
    const charge = await db.selectFrom('txn.ann_charge')
      .select(['charge_no', 'base_no', 'status'])
      .where('charge_no', '=', chargeNo)
      .executeTakeFirst();
    if (!charge) throw new Error(`ANN charge not found: ${chargeNo}`);
    if (charge.status === 'DONE') throw new Error('Cannot change base on a completed charge');
    await this.assertAnnBaseAvailable(baseNo, chargeNo);
    const oldBase = charge.base_no;
    if (oldBase === baseNo) return { chargeNo, baseNo, status: charge.status };

    await db.updateTable('txn.ann_charge')
      .set({ base_no: baseNo } as never)
      .where('charge_no', '=', chargeNo)
      .execute();

    await db.insertInto('txn.shift_event_audit').values({
      event_type: 'ANN_BASE_CHANGED',
      entity_type: 'ann_charge',
      entity_id: chargeNo,
      machine_code: 'ANN',
      user_id: userId ?? null,
      payload: { oldBase, newBase: baseNo, userId: userId ?? null, timestamp: new Date().toISOString() },
    } as never).execute();

    return { chargeNo, baseNo, status: charge.status };
  }

  static async startAnnCharge(chargeNo: string) {
    const charge = await db.selectFrom('txn.ann_charge')
      .select(['charge_no', 'base_no', 'status'])
      .where('charge_no', '=', chargeNo)
      .executeTakeFirst();
    if (!charge) throw new Error(`ANN charge not found: ${chargeNo}`);
    if (charge.status === 'DONE') throw new Error('Charge already completed');
    assertAnnBaseAssigned(charge.base_no);
    if (charge.status === 'IN_PROCESS') return { chargeNo, status: charge.status };

    await db.updateTable('txn.ann_charge')
      .set({ status: 'IN_PROCESS' } as never)
      .where('charge_no', '=', chargeNo)
      .execute();
    const stages = await db.selectFrom('txn.ann_charge_stage').select('stage_id').where('charge_no', '=', chargeNo).execute();
    if (stages.length === 0) await this.seedAnnStages(chargeNo);
    return { chargeNo, status: 'IN_PROCESS' as const };
  }

  /** Seed WI stages from master (seq order); start LOADING immediately. Idempotent. */
  private static async seedAnnStages(chargeNo: string) {
    const defs = await db.selectFrom('master.ann_stage')
      .select(['stage_code', 'seq'])
      .where('is_active', '=', true)
      .where('default_active', '=', true)
      .orderBy('seq', 'asc')
      .execute();
    if (defs.length === 0) throw new Error('master.ann_stage is empty — run ANN stage seed migration');

    const now = new Date();
    for (const d of defs) {
      await db.insertInto('txn.ann_charge_stage').values({
        charge_no: chargeNo,
        stage_code: d.stage_code,
        seq: d.seq,
        start_at: d.seq === 1 ? now : null,
        skipped: false,
      } as never)
        .onConflict((oc) => oc.columns(['charge_no', 'stage_code']).doNothing())
        .execute();
    }

    const active = await db.selectFrom('txn.ann_charge_stage')
      .select('stage_code')
      .where('charge_no', '=', chargeNo)
      .where('skipped', '=', false)
      .where('start_at', 'is not', null)
      .where('end_at', 'is', null)
      .executeTakeFirst();

    let current = active?.stage_code ?? null;
    if (!current) {
      const first = await db.selectFrom('txn.ann_charge_stage')
        .select(['stage_id', 'stage_code', 'start_at'])
        .where('charge_no', '=', chargeNo)
        .where('skipped', '=', false)
        .where('end_at', 'is', null)
        .orderBy('seq', 'asc')
        .executeTakeFirst();
      if (first) {
        await db.updateTable('txn.ann_charge_stage')
          .set({ start_at: first.start_at ?? now } as never)
          .where('stage_id', '=', first.stage_id)
          .execute();
        current = first.stage_code;
      }
    }

    await db.updateTable('txn.ann_charge')
      .set({ current_stage_code: current ?? defs[0]?.stage_code ?? null } as never)
      .where('charge_no', '=', chargeNo)
      .execute();
  }

  static async rosterAnnCoil(chargeNo: string, coilNo: string, seqNo?: number) {
    const dup = await db.selectFrom('txn.ann_charge_coil').select('coil_no').where('charge_no', '=', chargeNo).where('coil_no', '=', coilNo).executeTakeFirst();
    if (!dup) await db.insertInto('txn.ann_charge_coil').values({ charge_no: chargeNo, coil_no: coilNo, seq_no: seqNo ?? null, disposition: 'ADVANCE' } as never).execute();
    await this.refreshAnnChargeDerived(chargeNo);
  }

  static async setAnnCoilDisposition(chargeNo: string, coilNo: string, disposition: 'ADVANCE' | 'HOLD' | 'REJECT', unloadRemark?: string) {
    await db.updateTable('txn.ann_charge_coil')
      .set({ disposition, unload_remark: unloadRemark ?? null } as never)
      .where('charge_no', '=', chargeNo)
      .where('coil_no', '=', coilNo)
      .execute();
  }

  /** Close active stage, open next. Unloading end → DONE + fan-out. */
  /** Reject stage advance/skip while an open stoppage exists. */
  static async assertNoOpenAnnStoppage(chargeNo: string) {
    const open = await db.selectFrom('txn.ann_charge_stoppage')
      .select('stoppage_id')
      .where('charge_no', '=', chargeNo)
      .where('end_at', 'is', null)
      .executeTakeFirst();
    if (open) throw new Error('Close open stoppage before continuing');
  }

  static async advanceAnnStage(chargeNo: string, opts?: { transitionTempDegc?: number; userId?: number }) {
    const header = await db.selectFrom('txn.ann_charge')
      .select(['base_no', 'status'])
      .where('charge_no', '=', chargeNo)
      .executeTakeFirst();
    if (!header) throw new Error(`ANN charge not found: ${chargeNo}`);
    if (header.status === 'PREPARING' || !header.base_no) {
      throw new Error(ANN_BASE_REQUIRED_MSG);
    }
    await this.assertNoOpenAnnStoppage(chargeNo);

    const active = await db.selectFrom('txn.ann_charge_stage')
      .select(['stage_id', 'stage_code', 'start_at'])
      .where('charge_no', '=', chargeNo)
      .where('skipped', '=', false)
      .where('start_at', 'is not', null)
      .where('end_at', 'is', null)
      .executeTakeFirst();
    if (!active) throw new Error('No active ANN stage');

    const now = new Date();
    const durationMin = (now.getTime() - new Date(String(active.start_at)).getTime()) / 60000;

    let transitionTemp = opts?.transitionTempDegc;
    if (transitionTemp == null) {
      const latest = await db.selectFrom('txn.ann_charge_reading')
        .select('charge_temp')
        .where('charge_no', '=', chargeNo)
        .orderBy('taken_at', 'desc')
        .executeTakeFirst();
      if (latest?.charge_temp != null) transitionTemp = Number(latest.charge_temp);
    }

    await db.updateTable('txn.ann_charge_stage')
      .set({ end_at: now, duration_min: durationMin, transition_temp_degc: transitionTemp ?? null } as never)
      .where('stage_id', '=', active.stage_id)
      .execute();

    if (active.stage_code === 'UNLOADING') {
      await this.refreshAnnTotals(chargeNo);
      await this.transitionAnnCharge(chargeNo, 'DONE', {});
      return { done: true, closedStage: active.stage_code };
    }

    // ponytail: skip over already-skipped rows when finding next
    const next = await db.selectFrom('txn.ann_charge_stage')
      .select(['stage_id', 'stage_code'])
      .where('charge_no', '=', chargeNo)
      .where('skipped', '=', false)
      .where('start_at', 'is', null)
      .orderBy('seq', 'asc')
      .executeTakeFirst();

    if (!next) {
      await this.refreshAnnTotals(chargeNo);
      await this.transitionAnnCharge(chargeNo, 'DONE', {});
      return { done: true, closedStage: active.stage_code };
    }

    await db.updateTable('txn.ann_charge_stage')
      .set({ start_at: now, started_by_user_id: opts?.userId ?? null } as never)
      .where('stage_id', '=', next.stage_id)
      .execute();
    await db.updateTable('txn.ann_charge')
      .set({ current_stage_code: next.stage_code } as never)
      .where('charge_no', '=', chargeNo)
      .execute();
    await this.refreshAnnTotals(chargeNo);
    return { done: false, closedStage: active.stage_code, openStage: next.stage_code };
  }

  static async skipAnnStage(chargeNo: string, stageCode: string, opts: { authorizedBy: number; reason?: string }) {
    if (!Number.isFinite(opts.authorizedBy) || opts.authorizedBy <= 0) {
      throw new Error('Machine-Head authorization required to skip stage');
    }
    await this.assertNoOpenAnnStoppage(chargeNo);
    const def = await db.selectFrom('master.ann_stage').select(['stage_code', 'is_skippable']).where('stage_code', '=', stageCode).executeTakeFirst();
    if (!def?.is_skippable) throw new Error(`Stage ${stageCode} is not skippable`);

    const stage = await db.selectFrom('txn.ann_charge_stage')
      .select(['stage_id', 'stage_code', 'start_at', 'end_at', 'duration_min'])
      .where('charge_no', '=', chargeNo)
      .where('stage_code', '=', stageCode)
      .executeTakeFirst();
    if (!stage) throw new Error(`Stage ${stageCode} not on charge`);
    if (stage.end_at) throw new Error(`Stage ${stageCode} already closed`);

    const wasActive = stage.start_at != null && stage.end_at == null;
    await db.updateTable('txn.ann_charge_stage')
      .set({
        skipped: true,
        skip_authorized_by: opts.authorizedBy,
        skip_reason: opts.reason ?? null,
        end_at: wasActive ? new Date() : stage.end_at,
        duration_min: wasActive ? 0 : stage.duration_min,
      } as never)
      .where('stage_id', '=', stage.stage_id)
      .execute();

    if (wasActive) {
      const next = await db.selectFrom('txn.ann_charge_stage')
        .select(['stage_id', 'stage_code'])
        .where('charge_no', '=', chargeNo)
        .where('skipped', '=', false)
        .where('start_at', 'is', null)
        .orderBy('seq', 'asc')
        .executeTakeFirst();
      if (next) {
        await db.updateTable('txn.ann_charge_stage')
          .set({ start_at: new Date(), started_by_user_id: opts.authorizedBy } as never)
          .where('stage_id', '=', next.stage_id)
          .execute();
        await db.updateTable('txn.ann_charge')
          .set({ current_stage_code: next.stage_code } as never)
          .where('charge_no', '=', chargeNo)
          .execute();
      }
    }
    await this.refreshAnnTotals(chargeNo);
  }

  static async appendAnnReading(input: {
    chargeNo: string; baseNo?: string; shiftCode?: string; operatorUserId?: number;
    chargeTemp?: number; gasTemp?: number; fcTemp?: number; n2h2Flow?: number;
    basePress?: number; baseFanRpm?: number; fuelFlow?: number; rcfRpm?: number;
  }) {
    const charge = await db.selectFrom('txn.ann_charge').select(['base_no', 'current_stage_code']).where('charge_no', '=', input.chargeNo).executeTakeFirst();
    if (!charge) throw new Error(`ANN charge not found: ${input.chargeNo}`);
    await db.insertInto('txn.ann_charge_reading').values({
      charge_no: input.chargeNo,
      base_no: input.baseNo ?? charge.base_no,
      stage_code: charge.current_stage_code,
      shift_code: input.shiftCode ?? null,
      operator_user_id: input.operatorUserId ?? null,
      charge_temp: input.chargeTemp ?? null,
      gas_temp: input.gasTemp ?? null,
      fc_temp: input.fcTemp ?? null,
      n2h2_flow: input.n2h2Flow ?? null,
      base_press: input.basePress ?? null,
      base_fan_rpm: input.baseFanRpm ?? null,
      fuel_flow: input.fuelFlow ?? null,
      rcf_rpm: input.rcfRpm ?? null,
    } as never).execute();
  }

  static async startAnnStoppage(input: { chargeNo: string; categoryCode: string; reason?: string; remark?: string; baseNo?: string }) {
    const charge = await db.selectFrom('txn.ann_charge').select('base_no').where('charge_no', '=', input.chargeNo).executeTakeFirst();
    if (!charge) throw new Error(`ANN charge not found: ${input.chargeNo}`);
    await db.insertInto('txn.ann_charge_stoppage').values({
      charge_no: input.chargeNo,
      base_no: input.baseNo ?? charge.base_no,
      category_code: input.categoryCode,
      start_at: new Date(),
      reason: input.reason ?? null,
      remark: input.remark ?? null,
    } as never).execute();
  }

  static async endAnnStoppage(stoppageId: string) {
    const row = await db.selectFrom('txn.ann_charge_stoppage')
      .select(['stoppage_id', 'start_at', 'end_at'])
      .where('stoppage_id', '=', stoppageId)
      .executeTakeFirst();
    if (!row || row.end_at) return;
    const now = new Date();
    const durationMin = (now.getTime() - new Date(String(row.start_at)).getTime()) / 60000;
    await db.updateTable('txn.ann_charge_stoppage')
      .set({ end_at: now, duration_min: durationMin } as never)
      .where('stoppage_id', '=', stoppageId)
      .execute();
  }

  static async listAnnSpecLimits() {
    return db.selectFrom('master.ann_spec_limit')
      .select(['param_key', 'scope', 'min_val', 'max_val', 'unit', 'is_active'])
      .where('is_active', '=', true)
      .execute();
  }

  static async upsertAnnSpecLimit(row: {
    paramKey: string; scope: string; minVal?: number | null; maxVal?: number | null; unit?: string | null; isActive?: boolean;
  }) {
    await db.insertInto('master.ann_spec_limit')
      .values({
        param_key: row.paramKey,
        scope: row.scope,
        min_val: row.minVal ?? null,
        max_val: row.maxVal ?? null,
        unit: row.unit ?? null,
        is_active: row.isActive ?? true,
      } as never)
      .onConflict((oc) => oc.columns(['param_key', 'scope']).doUpdateSet({
        min_val: row.minVal ?? null,
        max_val: row.maxVal ?? null,
        unit: row.unit ?? null,
        is_active: row.isActive ?? true,
      } as never))
      .execute();
  }

  static async listAnnBases() {
    return db.selectFrom('master.ann_base')
      .select(['base_no', 'capacity_max_coils', 'capacity_max_wt_mt', 'capacity_max_height_mm', 'soak_time_adj_hr', 'is_active'])
      .where('is_active', '=', true)
      .execute();
  }

  static async upsertAnnBase(input: {
    baseNo: string;
    capacityMaxCoils?: number | null;
    capacityMaxWtMt?: number | null;
    capacityMaxHeightMm?: number | null;
    soakTimeAdjHr?: number | null;
    isActive?: boolean;
  }) {
    const baseNo = input.baseNo.trim().toUpperCase();
    if (!baseNo) throw new Error('baseNo required');
    if (input.isActive === false) {
      await db.updateTable('master.ann_base')
        .set({ is_active: false } as never)
        .where('base_no', '=', baseNo)
        .execute();
      return baseNo;
    }
    const patch = {
      capacity_max_coils: input.capacityMaxCoils ?? null,
      capacity_max_wt_mt: input.capacityMaxWtMt ?? null,
      capacity_max_height_mm: input.capacityMaxHeightMm ?? null,
      is_active: true,
      ...(input.soakTimeAdjHr != null ? { soak_time_adj_hr: input.soakTimeAdjHr } : {}),
    };
    await db.insertInto('master.ann_base').values({
      base_no: baseNo,
      soak_time_adj_hr: input.soakTimeAdjHr ?? 0,
      ...patch,
    } as never)
      .onConflict((oc) => oc.column('base_no').doUpdateSet(patch as never))
      .execute();
    return baseNo;
  }

  static async listAnnStoppageCategories() {
    return db.selectFrom('master.ann_stoppage_category')
      .select(['category_code', 'description', 'delay_bucket', 'is_active'])
      .orderBy('category_code', 'asc')
      .execute();
  }

  /** ANN-only shift review aggregate — charges/stoppages/dew for one shift log. */
  static async getAnnShiftReview(shiftLogId: string) {
    const { aggregateAnnDelayBuckets, mapAnnCrewRoles } = await import('../lib/annShiftReviewAgg');
    const charges = await db.selectFrom('txn.ann_charge')
      .select([
        'charge_no',
        'base_no',
        'annealing_batch_no',
        'grade_code',
        'no_of_coils',
        'charge_wt_mt',
        'status',
        'exp_unloading_time',
        'unloading_wt_mt',
        'temperature_degc',
        'furnace_id',
        'dew_point_n2',
        'dew_point_h2',
        'loading_mt',
        'unloading_mt',
        'cumm_loading_mt',
        'cumm_unloading_mt',
      ])
      .where('shift_log_id', '=', shiftLogId)
      .orderBy('charge_no', 'asc')
      .execute();

    const chargeNos = charges.map((c) => c.charge_no);
    const latestReading = new Map<string, Record<string, unknown>>();
    let stoppages: Array<Record<string, unknown>> = [];

    if (chargeNos.length > 0) {
      const readings = await db.selectFrom('txn.ann_charge_reading')
        .select(['charge_no', 'taken_at', 'charge_temp', 'fc_temp'])
        .where('charge_no', 'in', chargeNos)
        .orderBy('taken_at', 'desc')
        .execute();
      for (const r of readings) {
        if (!latestReading.has(r.charge_no)) latestReading.set(r.charge_no, r as never);
      }
      stoppages = await db.selectFrom('txn.ann_charge_stoppage as s')
        .leftJoin('master.ann_stoppage_category as c', 'c.category_code', 's.category_code')
        .select([
          's.stoppage_id',
          's.charge_no',
          's.base_no',
          's.category_code',
          'c.description as category_label',
          'c.delay_bucket',
          's.reason',
          's.remark',
          's.start_at',
          's.end_at',
          's.duration_min',
        ])
        .where('s.charge_no', 'in', chargeNos)
        .orderBy('s.start_at', 'desc')
        .execute() as never;
    }

    const remarks: string[] = [];
    for (const s of stoppages) {
      const note = [s.reason, s.remark].filter(Boolean).join(' — ');
      if (note) remarks.push(`${s.charge_no}: ${note}`);
    }
    const { delaySummary, totalDelayMin } = aggregateAnnDelayBuckets(
      stoppages as Array<{ delay_bucket?: string | null; category_code?: string | null; duration_min?: number | string | null }>,
    );

    const { CrewService } = await import('./ancillaryServices');
    const crewRows = await CrewService.listByShiftLog(shiftLogId).catch(() => [] as Array<{ operatorName: string; roleCode: string }>);
    const crew = mapAnnCrewRoles(crewRows);

    const processRows = charges.map((c) => {
      const lr = latestReading.get(c.charge_no);
      const temp = lr?.charge_temp ?? lr?.fc_temp ?? c.temperature_degc ?? null;
      return {
        base_no: c.base_no,
        charge_no: c.charge_no,
        annealing_batch_no: c.annealing_batch_no,
        grade_code: c.grade_code,
        no_of_coils: c.no_of_coils,
        charge_wt_mt: c.charge_wt_mt,
        status: c.status,
        exp_unloading_time: c.exp_unloading_time,
        unloading_wt_mt: c.unloading_wt_mt,
        temp,
        furnace_id: c.furnace_id,
        dew_point_n2: c.dew_point_n2,
        dew_point_h2: c.dew_point_h2,
        loading_mt: c.loading_mt,
        unloading_mt: c.unloading_mt,
        cumm_loading_mt: c.cumm_loading_mt,
        cumm_unloading_mt: c.cumm_unloading_mt,
      };
    });

    const forAnn = charges.filter((c) => c.status === 'FOR_ANN').length;
    const rw = charges.filter((c) => c.status === 'RW').length;
    const inProcess = charges.filter((c) => c.status === 'IN_PROCESS').length;
    const sum = (key: 'loading_mt' | 'unloading_mt' | 'unloading_wt_mt' | 'charge_wt_mt' | 'cumm_loading_mt' | 'cumm_unloading_mt') =>
      charges.reduce((acc, c) => acc + Number(c[key] ?? 0), 0);

    return {
      shiftLogId,
      process: processRows,
      stoppages,
      delaySummary,
      totalDelayMin,
      remarks: remarks.join('; ') || null,
      crew,
      production: {
        unloadMt: sum('unloading_mt') || sum('unloading_wt_mt'),
        loadMt: sum('loading_mt') || sum('charge_wt_mt'),
      },
      dew: {
        n2: charges.map((c) => c.dew_point_n2).find((v) => v != null) ?? null,
        h2: charges.map((c) => c.dew_point_h2).find((v) => v != null) ?? null,
      },
      inProcess: { forAnn, rw, inProcess, total: charges.length },
      cumulative: {
        unloadMt: sum('cumm_unloading_mt'),
        loadMt: sum('cumm_loading_mt'),
      },
    };
  }

  /** One row per active base: occupying charge + stage progress + latest reading. */
  static async getAnnBoard() {
    const bases = await this.listAnnBases();
    const charges = await db.selectFrom('txn.ann_charge')
      .select([
        'charge_no',
        'base_no',
        'annealing_batch_no',
        'status',
        'current_stage_code',
        'no_of_coils',
        'charge_wt_mt',
        'soak_temp_degc',
        'soak_time_hr',
        'total_active_min',
        'grade_code',
      ])
      .where('base_no', 'is not', null)
      .orderBy('charge_no', 'desc')
      .execute();

    const byBase = new Map<string, (typeof charges)[0]>();
    for (const c of charges) {
      const base = c.base_no as string;
      const existing = byBase.get(base);
      if (!existing) {
        byBase.set(base, c);
        continue;
      }
      // Prefer non-DONE over DONE; otherwise keep newest charge_no (already desc-ordered).
      if (existing.status === 'DONE' && c.status !== 'DONE') byBase.set(base, c);
    }

    const chargeNos = [...byBase.values()].map((c) => c.charge_no);
    const stageStats = new Map<string, { done: number; total: number; activeStart: string | null }>();
    const latestReading = new Map<string, Record<string, unknown>>();
    const openStoppage = new Set<string>();

    if (chargeNos.length > 0) {
      const stages = await db.selectFrom('txn.ann_charge_stage')
        .select(['charge_no', 'end_at', 'skipped', 'start_at'])
        .where('charge_no', 'in', chargeNos)
        .execute();
      for (const s of stages) {
        const cur = stageStats.get(s.charge_no) ?? { done: 0, total: 0, activeStart: null as string | null };
        cur.total += 1;
        if (s.end_at != null || s.skipped) cur.done += 1;
        if (s.start_at != null && s.end_at == null && !s.skipped) {
          cur.activeStart = s.start_at instanceof Date ? s.start_at.toISOString() : String(s.start_at);
        }
        stageStats.set(s.charge_no, cur);
      }

      const readings = await db.selectFrom('txn.ann_charge_reading')
        .select(['charge_no', 'taken_at', 'charge_temp', 'base_press', 'base_fan_rpm'])
        .where('charge_no', 'in', chargeNos)
        .orderBy('taken_at', 'desc')
        .execute();
      for (const r of readings) {
        if (!latestReading.has(r.charge_no)) latestReading.set(r.charge_no, r as never);
      }

      const stops = await db.selectFrom('txn.ann_charge_stoppage')
        .select(['charge_no'])
        .where('charge_no', 'in', chargeNos)
        .where('end_at', 'is', null)
        .execute();
      for (const s of stops) openStoppage.add(s.charge_no);
    }

    const stagesTotalDefault = await db.selectFrom('master.ann_stage')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('is_active', '=', true)
      .executeTakeFirst();
    const defaultTotal = Number(stagesTotalDefault?.n ?? 10);

    return bases.map((b) => {
      const charge = byBase.get(b.base_no) ?? null;
      const stats = charge ? stageStats.get(charge.charge_no) : undefined;
      return {
        base_no: b.base_no,
        capacity_max_coils: b.capacity_max_coils,
        capacity_max_wt_mt: b.capacity_max_wt_mt,
        soak_time_adj_hr: b.soak_time_adj_hr,
        charge: charge
          ? {
              charge_no: charge.charge_no,
              annealing_batch_no: charge.annealing_batch_no,
              status: charge.status,
              current_stage_code: charge.current_stage_code,
              no_of_coils: charge.no_of_coils,
              charge_wt_mt: charge.charge_wt_mt,
              soak_temp_degc: charge.soak_temp_degc,
              soak_time_hr: charge.soak_time_hr,
              total_active_min: charge.total_active_min,
              grade_code: charge.grade_code,
            }
          : null,
        stages_done: stats?.done ?? 0,
        stages_total: stats?.total || defaultTotal,
        active_stage_start_at: stats?.activeStart ?? null,
        latest_reading: charge ? (latestReading.get(charge.charge_no) ?? null) : null,
        has_open_stoppage: charge ? openStoppage.has(charge.charge_no) : false,
      };
    });
  }

  static async transitionAnnCharge(chargeNo: string, status: 'PREPARING' | 'IN_PROCESS' | 'FOR_ANN' | 'RW' | 'DONE', extras?: { furnaceId?: number; dewPointN2?: number; dewPointH2?: number; temperatureDegc?: number }) {
    const charge = await db.selectFrom('txn.ann_charge')
      .select(['status', 'base_no'])
      .where('charge_no', '=', chargeNo)
      .executeTakeFirst();
    if (!charge) throw new Error(`ANN charge not found: ${chargeNo}`);

    // Idempotent transitions: re-saving the same status is a no-op.
    if (charge.status === status) return;

    if (status === 'IN_PROCESS') {
      assertAnnBaseAssigned(charge.base_no);
    }

    // Guard: IN_PROCESS → FOR_ANN → RW; DONE allowed from any non-DONE (unload completion).
    if (status === 'FOR_ANN' && charge.status !== 'IN_PROCESS') {
      throw new Error(`Invalid ANN charge transition: ${charge.status} → FOR_ANN`);
    }
    if (status === 'RW' && charge.status !== 'FOR_ANN') {
      throw new Error(`Invalid ANN charge transition: ${charge.status} → RW`);
    }

    await db.updateTable('txn.ann_charge')
      .set({
        status,
        furnace_id: extras?.furnaceId,
        dew_point_n2: extras?.dewPointN2,
        dew_point_h2: extras?.dewPointH2,
        temperature_degc: extras?.temperatureDegc,
      })
      .where('charge_no', '=', chargeNo)
      .execute();

    if (status === 'DONE') {
      await this.refreshAnnChargeDerived(chargeNo);
      await this.fanOutAnnCharge(chargeNo);
    }
  }

  /** ADVANCE disposition only; HOLD/REJECT stay put. */
  private static async fanOutAnnCharge(chargeNo: string) {
    const roster = await db.selectFrom('txn.ann_charge_coil')
      .select(['coil_no', 'disposition'])
      .where('charge_no', '=', chargeNo)
      .execute();

    for (const row of roster) {
      if (row.disposition && row.disposition !== 'ADVANCE') continue;

      const journey = await db.selectFrom('planning.order_journey')
        .select(['journey_id', 'current_step_no'])
        .where('coil_no', '=', row.coil_no)
        .where('status', '=', 'ACTIVE')
        .executeTakeFirst();
      if (!journey) continue;

      const currentAnnStep = await db.selectFrom('planning.order_journey_step')
        .select('status')
        .where('journey_id', '=', String(journey.journey_id))
        .where('step_no', '=', journey.current_step_no)
        .where('process_code', '=', 'ANN')
        .executeTakeFirst();

      if (!currentAnnStep || currentAnnStep.status !== 'ACTIVE') continue;

      try {
        await ProcessRouteService.advanceJourneyByCoil(row.coil_no, {});
      } catch (err) {
        // JourneyHandoffScheduler heals stranded coils; keep fan-out non-blocking.
        const { recordAnnFanoutAdvanceFailed } = await import('./handoffMetrics');
        recordAnnFanoutAdvanceFailed();
        console.error(
          JSON.stringify({
            msg: 'ann_fanout_advance_failed',
            coilNo: row.coil_no,
            chargeNo,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }

  /** Σ non-skipped stage durations → total_active_min; idle = gaps between stages. */
  private static async refreshAnnTotals(chargeNo: string) {
    const stages = await db.selectFrom('txn.ann_charge_stage')
      .select(['seq', 'start_at', 'end_at', 'duration_min'])
      .where('charge_no', '=', chargeNo)
      .where('skipped', '=', false)
      .orderBy('seq', 'asc')
      .execute();
    const totalActive = stages.reduce((s, r) => s + Number(r.duration_min ?? 0), 0);
    let totalIdle = 0;
    for (let i = 1; i < stages.length; i++) {
      const prev = stages[i - 1];
      const cur = stages[i];
      if (prev.end_at && cur.start_at) {
        totalIdle += (new Date(String(cur.start_at)).getTime() - new Date(String(prev.end_at)).getTime()) / 60000;
      }
    }
    await db.updateTable('txn.ann_charge')
      .set({ total_active_min: totalActive, total_idle_min: Math.max(0, totalIdle) } as never)
      .where('charge_no', '=', chargeNo)
      .execute();
  }

  private static async refreshAnnChargeDerived(chargeNo: string) {
    const roster = await db.selectFrom('txn.ann_charge_coil as acc').innerJoin('coil.coil as c', 'c.coil_no', 'acc.coil_no').select(['c.weight_mt']).where('acc.charge_no', '=', chargeNo).execute();
    const chargeWt = roster.reduce((sum, r) => sum + Number(r.weight_mt ?? 0), 0);
    await db.updateTable('txn.ann_charge').set({ no_of_coils: roster.length, charge_wt_mt: chargeWt }).where('charge_no', '=', chargeNo).execute();
  }

  /** Order-level production history for operator History tab (HRS/PKL/RWD). */
  static async getProcessOrderHistory(process: string, shiftLogId: string) {
    const code = process.toUpperCase();
    if (code === 'HRS') {
      // Grade from prod_hrs/coil; finish from coil → slit → PPC roll_finish.
      const rows = await db.selectFrom('txn.prod_hrs as ph')
        .leftJoin('coil.coil as c', 'c.coil_no', 'ph.coil_no')
        .select([
          'ph.entry_id', 'ph.coil_no', 'ph.grade_code', 'ph.weight_mt', 'ph.scrap_mt',
          'ph.net_runtime_min', 'ph.status', 'ph.time_from', 'ph.time_to', 'ph.shift_code',
          'c.grade_code as coil_grade_code', 'c.surface_finish as coil_surface_finish',
        ])
        .where('ph.shift_log_id', '=', shiftLogId as never)
        .orderBy('ph.entry_id', 'desc')
        .limit(200)
        .execute();

      const entryIds = rows.map((r) => r.entry_id).filter((id) => id != null);
      const coilNos = [...new Set(rows.map((r) => String(r.coil_no ?? '')).filter(Boolean))];

      const slitFinishByEntry = new Map<string, string>();
      if (entryIds.length > 0) {
        const slits = await db.selectFrom('txn.prod_hrs_slit')
          .select(['entry_id', 'surface_finish'])
          .where('entry_id', 'in', entryIds as never[])
          .where('surface_finish', 'is not', null)
          .execute();
        for (const s of slits) {
          const key = String(s.entry_id);
          const finish = String(s.surface_finish ?? '').trim();
          if (finish && !slitFinishByEntry.has(key)) slitFinishByEntry.set(key, finish);
        }
      }

      const ppcFinishByCoil = new Map<string, string>();
      if (coilNos.length > 0) {
        const batches = await db.selectFrom('planning.ppc_batch')
          .select(['coil_no', 'roll_finish'])
          .where('coil_no', 'in', coilNos)
          .where('machine_code', '=', 'HRS')
          .where('roll_finish', 'is not', null)
          .orderBy('batch_id', 'desc')
          .execute();
        for (const b of batches) {
          const coil = String(b.coil_no ?? '');
          const finish = String(b.roll_finish ?? '').trim();
          if (coil && finish && !ppcFinishByCoil.has(coil)) ppcFinishByCoil.set(coil, finish);
        }
      }

      const completed = rows.map((r) => {
        const entryKey = String(r.entry_id);
        const coil = String(r.coil_no ?? '');
        const surfaceFinish = (r.coil_surface_finish && String(r.coil_surface_finish).trim())
          || slitFinishByEntry.get(entryKey)
          || ppcFinishByCoil.get(coil)
          || null;
        return {
          id: entryKey,
          coilNo: r.coil_no,
          gradeCode: r.grade_code ?? r.coil_grade_code ?? null,
          surfaceFinish,
          weightMt: r.weight_mt != null ? Number(r.weight_mt) : null,
          scrapMt: r.scrap_mt != null ? Number(r.scrap_mt) : null,
          durationMin: r.net_runtime_min != null ? Number(r.net_runtime_min) : null,
          status: r.status || 'COMPLETED',
          timeFrom: r.time_from,
          timeTo: r.time_to,
          shiftCode: r.shift_code,
        };
      });

      // Hold lives on hrs_order (REJECTED), not prod_hrs — surface for Order Hold pill.
      const held = await db.selectFrom('txn.hrs_order as ho')
        .leftJoin('coil.coil as c', 'c.coil_no', 'ho.coil_no')
        .select([
          'ho.order_id', 'ho.coil_no', 'ho.grade_code', 'ho.mother_coil_weight_mt',
          'ho.held_at', 'ho.shift_code', 'ho.status',
          'c.grade_code as coil_grade_code', 'c.surface_finish as coil_surface_finish',
        ])
        .where('ho.shift_log_id', '=', shiftLogId as never)
        .where('ho.status', '=', 'REJECTED')
        .orderBy('ho.held_at', 'desc')
        .limit(200)
        .execute();

      const heldCoilNos = [...new Set(held.map((r) => String(r.coil_no ?? '')).filter(Boolean))];
      const heldPpcFinish = new Map<string, string>();
      if (heldCoilNos.length > 0) {
        const batches = await db.selectFrom('planning.ppc_batch')
          .select(['coil_no', 'roll_finish'])
          .where('coil_no', 'in', heldCoilNos)
          .where('machine_code', '=', 'HRS')
          .where('roll_finish', 'is not', null)
          .orderBy('batch_id', 'desc')
          .execute();
        for (const b of batches) {
          const coil = String(b.coil_no ?? '');
          const finish = String(b.roll_finish ?? '').trim();
          if (coil && finish && !heldPpcFinish.has(coil)) heldPpcFinish.set(coil, finish);
        }
      }

      const holdRows = held.map((r) => {
        const coil = String(r.coil_no ?? '');
        const surfaceFinish = (r.coil_surface_finish && String(r.coil_surface_finish).trim())
          || heldPpcFinish.get(coil)
          || null;
        return {
          id: `hold-${r.order_id}`,
          coilNo: r.coil_no,
          gradeCode: r.grade_code ?? r.coil_grade_code ?? null,
          surfaceFinish,
          weightMt: r.mother_coil_weight_mt != null ? Number(r.mother_coil_weight_mt) : null,
          scrapMt: null as number | null,
          durationMin: null as number | null,
          status: 'REJECTED',
          timeFrom: r.held_at,
          timeTo: null as Date | null,
          shiftCode: r.shift_code,
        };
      });

      return [...holdRows, ...completed];
    }
    if (code === 'PKL') {
      const rows = await db.selectFrom('txn.prod_pkl')
        .select(['entry_id', 'coil_no', 'grade_code', 'weight_mt', 'line_speed_mpm', 'repeats', 'wp', 'end_filling', 'shift_code'])
        .where('shift_log_id', '=', shiftLogId as never)
        .orderBy('entry_id', 'desc')
        .limit(200)
        .execute();
      return rows.map((r) => ({
        id: String(r.entry_id),
        coilNo: r.coil_no,
        gradeCode: r.grade_code,
        weightMt: r.weight_mt != null ? Number(r.weight_mt) : null,
        lineSpeedMpm: r.line_speed_mpm != null ? Number(r.line_speed_mpm) : null,
        repeats: r.repeats,
        wp: r.wp,
        endFilling: r.end_filling,
        shiftCode: r.shift_code,
      }));
    }
    if (code === 'RWD') {
      const rows = await db.selectFrom('txn.prod_rwd')
        .select([
          'entry_id', 'coil_no', 'weight_mt', 'surface_finish', 'shift_code',
          'rw_tension_1_kg', 'rw_tension_2_kg', 'rw_tension_3_kg', 'time_from', 'time_to',
        ])
        .where('shift_log_id', '=', shiftLogId as never)
        .orderBy('entry_id', 'desc')
        .limit(200)
        .execute();
      return rows.map((r) => ({
        id: String(r.entry_id),
        coilNo: r.coil_no,
        weightMt: r.weight_mt != null ? Number(r.weight_mt) : null,
        surfaceFinish: r.surface_finish,
        tension1Kg: r.rw_tension_1_kg != null ? Number(r.rw_tension_1_kg) : null,
        tension2Kg: r.rw_tension_2_kg != null ? Number(r.rw_tension_2_kg) : null,
        tension3Kg: r.rw_tension_3_kg != null ? Number(r.rw_tension_3_kg) : null,
        timeFrom: r.time_from,
        timeTo: r.time_to,
        shiftCode: r.shift_code,
      }));
    }
    throw new Error(`History not supported for ${code}`);
  }

  /** Shift field readings for HRS (width) / RWD (tension rows from prod). */
  static async getProcessReadings(process: string, shiftLogId: string) {
    const code = process.toUpperCase();
    if (code === 'HRS') {
      const rows = await db.selectFrom('txn.prod_hrs_width_reading as wr')
        .innerJoin('txn.prod_hrs as ph', 'ph.entry_id', 'wr.entry_id')
        .select(['wr.reading_id', 'wr.reading_time', 'wr.actual_width_mm', 'ph.coil_no'])
        .where('ph.shift_log_id', '=', shiftLogId as never)
        .orderBy('wr.reading_time', 'desc')
        .limit(300)
        .execute();
      return rows.map((r) => ({
        id: String(r.reading_id),
        takenAt: r.reading_time ? new Date(String(r.reading_time)).toISOString() : null,
        coilNo: r.coil_no,
        actualWidthMm: r.actual_width_mm != null ? Number(r.actual_width_mm) : null,
      }));
    }
    if (code === 'RWD') {
      // ponytail: prod_rwd is the reading log until a dedicated readings table exists
      const rows = await db.selectFrom('txn.prod_rwd')
        .select([
          'entry_id', 'coil_no', 'weight_mt', 'surface_finish',
          'rw_tension_1_kg', 'rw_tension_2_kg', 'rw_tension_3_kg', 'time_from',
        ])
        .where('shift_log_id', '=', shiftLogId as never)
        .orderBy('entry_id', 'desc')
        .limit(200)
        .execute();
      return rows.map((r) => ({
        id: String(r.entry_id),
        takenAt: null as string | null,
        coilNo: r.coil_no,
        weightMt: r.weight_mt != null ? Number(r.weight_mt) : null,
        surfaceFinish: r.surface_finish,
        tension1Kg: r.rw_tension_1_kg != null ? Number(r.rw_tension_1_kg) : null,
        tension2Kg: r.rw_tension_2_kg != null ? Number(r.rw_tension_2_kg) : null,
        tension3Kg: r.rw_tension_3_kg != null ? Number(r.rw_tension_3_kg) : null,
        timeFrom: r.time_from,
      }));
    }
    throw new Error(`Readings not supported for ${code}`);
  }
}
