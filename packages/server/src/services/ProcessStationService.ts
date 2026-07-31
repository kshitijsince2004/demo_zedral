import { z } from 'zod';
import type { JourneyStepStatus } from '@m1/shared-validation';
import { db } from '../db';
import { AutoSourceService } from './AutoSourceService';
import { ProcessRouteService } from './ProcessRouteService';

export type ProcessStationCode = 'HRS' | 'PKL' | 'ANN' | 'RWD' | 'CRS' | 'CTL';

export interface ProcessQueueCard {
  coilNo: string;
  displayCoilNo?: string;
  gradeCode: string;
  customerName: string;
  widthMm: number;
  thicknessMm: number;
  weightMt: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'HOLD' | 'COMPLETED';
  journeyId: string;
  stepNo: number;
  batchNumber?: string;
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
  gradeCode: z.string().min(1),
  customerName: z.string().min(1),
  widthMm: z.number().positive(),
  thicknessMm: z.number().positive(),
  weightMt: z.number().positive(),
  routeRaw: z.string().optional(),
  shiftCode: z.string().default('A'),
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

  static async getQueue(processCode: string): Promise<ProcessQueueCard[]> {
    const code = this.assertProcessCode(processCode);
    const rows = await db.selectFrom('planning.order_journey as oj')
      .innerJoin('planning.order_journey_step as ojs', (join) => join.onRef('ojs.journey_id', '=', 'oj.journey_id').onRef('ojs.step_no', '=', 'oj.current_step_no'))
      .innerJoin('coil.coil as c', 'c.coil_no', 'oj.coil_no')
      .leftJoin('master.customer as cu', 'c.customer_id', 'cu.customer_id')
      .leftJoin('planning.ppc_batch as pb', 'pb.batch_id', 'ojs.queue_batch_id')
      .select(['oj.journey_id','oj.coil_no','oj.status as journey_status','ojs.step_no','ojs.status as step_status','c.grade_code','c.nominal_width_mm','c.coil_width_mm','c.coil_thk_mm','c.weight_mt','cu.customer_name as customer_name','pb.batch_number'])
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
        widthMm: Number(prefill.widthMm?.value ?? row.nominal_width_mm ?? row.coil_width_mm ?? 0),
        thicknessMm: Number(prefill.thicknessMm?.value ?? row.coil_thk_mm ?? 0),
        weightMt: Number(prefill.weightMt?.value ?? row.weight_mt ?? 0),
        status: mapStepStatus(row.step_status, row.journey_status),
        journeyId: String(row.journey_id),
        stepNo: row.step_no,
        batchNumber: prefill.batchNumber?.value ?? row.batch_number ?? undefined,
        prefill,
      };

      if (code === 'PKL') {
        const mother = (prefill as { motherCoilNo?: { value?: string } }).motherCoilNo?.value;
        const slit = (prefill as { slitId?: { value?: string } }).slitId?.value;
        if (mother) card.motherCoilNo = mother;
        if (slit) card.slitId = slit;
      }

      if (code === 'CRS' || code === 'HRS') {
        const lines = await db.selectFrom('planning.ppc_batch')
          .select([
            'batch_number', 'width_mm', 'customer_name', 'process_route_raw',
            'machine_code', 'slit_id', 'ppc_weight_mt', 'finish_thk_mm',
            'input_thk_mm', 'to_work_center', 'roll_finish',
          ])
          .where('coil_no', '=', row.coil_no)
          .where((eb) => code === 'CRS'
            ? eb.or([
              eb('machine_code', 'like', 'CRS%'),
              eb('sub_process', '=', 'CRS'),
              eb('from_work_center', 'in', ['C', 'CRS']),
            ])
            : eb.or([
              eb('machine_code', '=', 'HRS'),
              eb('sub_process', '=', 'HRS'),
              eb('from_work_center', 'in', ['S', 'HRS']),
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
          suggestedMachine: code === 'CRS' && l.machine_code?.startsWith('CRS') ? l.machine_code : undefined,
        }));
        card.lineCount = Math.max(1, card.orderLines.length);
        if (code === 'HRS' && card.orderLines.length > 0) {
          card.combination = card.orderLines
            .map((ol) => (ol.widthMm != null ? String(ol.widthMm) : '?'))
            .join('+');
        }
      }

      cards.push(card);
    }
    return cards;
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
      .selectAll()
      .where('batch_id', '=', batchId)
      .executeTakeFirst();
    if (!batch) throw new Error('Batch not found');

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

    await db.updateTable('planning.ppc_batch')
      .set({ machine_code: code })
      .where('batch_id', '=', batchId)
      .execute();

    return { ok: true, eligibility: result };
  }

  static async getEntryPrefill(processCode: string, coilNo: string) {
    this.assertProcessCode(processCode);
    return AutoSourceService.resolvePrefill(processCode, coilNo);
  }

  static async createManualCoil(processCode: string, input: z.infer<typeof ProcessManualCoilSchema>) {
    const code = this.assertProcessCode(processCode);
    const data = ProcessManualCoilSchema.parse(input);
    const existing = await db.selectFrom('coil.coil').select('coil_no').where('coil_no', '=', data.coilNo).executeTakeFirst();
    if (!existing) await db.insertInto('coil.coil').values({ coil_no: data.coilNo, grade_code: data.gradeCode, nominal_width_mm: data.widthMm, coil_width_mm: data.widthMm, coil_thk_mm: data.thicknessMm, weight_mt: data.weightMt, status: 'PLANNED' }).execute();
    const routeRaw = (data.routeRaw ?? DEFAULT_ROUTES[code]).toUpperCase();
    const journeyId = await ProcessRouteService.createJourney(data.coilNo, routeRaw);
    const step = await db.selectFrom('planning.order_journey_step').select(['step_id','step_no']).where('journey_id', '=', String(journeyId)).where('route_code', '=', PROCESS_ROUTE_CODE[code]).executeTakeFirst();
    const batch = await db.insertInto('planning.ppc_batch').values({ batch_number: 'MAN-' + data.coilNo + '-' + Date.now().toString(36).toUpperCase(), plan_date: new Date(), shift_code: data.shiftCode, machine_code: code, sub_process: code, coil_no: data.coilNo, customer_name: data.customerName, grade_code: data.gradeCode, width_mm: data.widthMm, input_thk_mm: data.thicknessMm, ppc_thk_mm: data.thicknessMm, ppc_weight_mt: data.weightMt, queue_seq: 1, process_route_raw: routeRaw }).returning('batch_id').executeTakeFirstOrThrow();
    if (step) {
      await db.updateTable('planning.order_journey').set({ current_step_no: step.step_no, updated_at: new Date() }).where('journey_id', '=', String(journeyId)).execute();
      await db.updateTable('planning.order_journey_step').set({ status: 'ACTIVE' as JourneyStepStatus, started_at: new Date(), queue_batch_id: batch.batch_id }).where('step_id', '=', step.step_id).execute();
    }
    return { coilNo: data.coilNo, batchNumber: batch.batch_id, journeyId };
  }

  static async getPklChart(shiftLogId: string) {
    return db.selectFrom('txn.prod_pkl_chart').selectAll().where('shift_log_id', '=', shiftLogId).orderBy('chart_time', 'asc').orderBy('tank_no', 'asc').execute();
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
          rinse_acid_pct: line.rinseAcidPct ?? null,
          rinse_iron_pct: line.rinseIronPct ?? null,
          burner_pressure_kgcm2: line.burnerPressureKgcm2 ?? null,
          hot_air_temp_degc: line.hotAirTempDegc ?? null,
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

  static async listPklSpecLimits() {
    return db.selectFrom('master.pkl_spec_limit').selectAll().where('is_active', '=', true).execute();
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
    return db.selectFrom('master.pkl_chart_config').selectAll().where('is_active', '=', true).executeTakeFirst();
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

  static async getAnnCharges() { return db.selectFrom('txn.ann_charge as ac').selectAll().orderBy('ac.charge_no', 'desc').execute(); }

  static async getAnnChargeDetail(chargeNo: string) {
    const charge = await db.selectFrom('txn.ann_charge').selectAll().where('charge_no', '=', chargeNo).executeTakeFirst();
    if (!charge) return null;
    const roster = await db.selectFrom('txn.ann_charge_coil as acc')
      .innerJoin('coil.coil as c', 'c.coil_no', 'acc.coil_no')
      .select(['acc.coil_no', 'acc.seq_no', 'acc.disposition', 'acc.unload_remark', 'c.grade_code', 'c.weight_mt'])
      .where('acc.charge_no', '=', chargeNo)
      .orderBy('acc.seq_no', 'asc')
      .execute();
    let stages = await db.selectFrom('txn.ann_charge_stage').selectAll().where('charge_no', '=', chargeNo).orderBy('seq', 'asc').execute();
    // ponytail: backfill stages for pre-migration charges still open
    if (stages.length === 0 && charge.status !== 'DONE') {
      await this.seedAnnStages(chargeNo);
      stages = await db.selectFrom('txn.ann_charge_stage').selectAll().where('charge_no', '=', chargeNo).orderBy('seq', 'asc').execute();
    }
    const readings = await db.selectFrom('txn.ann_charge_reading').selectAll().where('charge_no', '=', chargeNo).orderBy('taken_at', 'desc').execute();
    const stoppages = await db.selectFrom('txn.ann_charge_stoppage').selectAll().where('charge_no', '=', chargeNo).orderBy('start_at', 'desc').execute();
    return { charge, roster, stages, readings, stoppages };
  }

  static async createAnnCharge(input: {
    chargeNo: string; baseNo?: string; shiftLogId: string; furnaceId?: number; gradeCode?: string;
    annealingBatchNo?: string; coolingHoodId?: number; soakTempDegc?: number; soakTimeHr?: number;
    coils?: Array<{ coilNo: string; seqNo?: number }>;
  }) {
    await db.insertInto('txn.ann_charge').values({
      charge_no: input.chargeNo,
      base_no: input.baseNo ?? null,
      shift_log_id: input.shiftLogId,
      furnace_id: input.furnaceId ?? null,
      grade_code: input.gradeCode ?? null,
      annealing_batch_no: input.annealingBatchNo ?? null,
      cooling_hood_id: input.coolingHoodId ?? null,
      soak_temp_degc: input.soakTempDegc ?? null,
      soak_time_hr: input.soakTimeHr ?? null,
      status: 'IN_PROCESS',
      no_of_coils: 0,
      charge_wt_mt: 0,
    } as never).execute();
    await this.seedAnnStages(input.chargeNo);
    if (input.coils?.length) {
      for (const c of input.coils) await this.rosterAnnCoil(input.chargeNo, c.coilNo, c.seqNo);
    }
    return input.chargeNo;
  }

  /** Seed 10 WI stages; start LOADING immediately. */
  private static async seedAnnStages(chargeNo: string) {
    const defs = await db.selectFrom('master.ann_stage').selectAll().where('is_active', '=', true).orderBy('seq', 'asc').execute();
    const now = new Date();
    for (const d of defs) {
      await db.insertInto('txn.ann_charge_stage').values({
        charge_no: chargeNo,
        stage_code: d.stage_code,
        seq: d.seq,
        start_at: d.seq === 1 ? now : null,
        skipped: false,
      } as never).execute();
    }
    await db.updateTable('txn.ann_charge')
      .set({ current_stage_code: defs[0]?.stage_code ?? null } as never)
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
  static async advanceAnnStage(chargeNo: string, opts?: { transitionTempDegc?: number; userId?: number }) {
    const active = await db.selectFrom('txn.ann_charge_stage')
      .selectAll()
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
      .selectAll()
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
    const def = await db.selectFrom('master.ann_stage').selectAll().where('stage_code', '=', stageCode).executeTakeFirst();
    if (!def?.is_skippable) throw new Error(`Stage ${stageCode} is not skippable`);

    const stage = await db.selectFrom('txn.ann_charge_stage')
      .selectAll()
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
        .selectAll()
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
    const row = await db.selectFrom('txn.ann_charge_stoppage').selectAll().where('stoppage_id', '=', stoppageId).executeTakeFirst();
    if (!row || row.end_at) return;
    const now = new Date();
    const durationMin = (now.getTime() - new Date(String(row.start_at)).getTime()) / 60000;
    await db.updateTable('txn.ann_charge_stoppage')
      .set({ end_at: now, duration_min: durationMin } as never)
      .where('stoppage_id', '=', stoppageId)
      .execute();
  }

  static async listAnnSpecLimits() {
    return db.selectFrom('master.ann_spec_limit').selectAll().where('is_active', '=', true).execute();
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
    return db.selectFrom('master.ann_base').selectAll().where('is_active', '=', true).execute();
  }

  static async createAnnBase(input: {
    baseNo: string;
    capacityMaxCoils?: number | null;
    capacityMaxWtMt?: number | null;
    capacityMaxHeightMm?: number | null;
    soakTimeAdjHr?: number | null;
  }) {
    const baseNo = input.baseNo.trim().toUpperCase();
    if (!baseNo) throw new Error('baseNo required');
    await db.insertInto('master.ann_base').values({
      base_no: baseNo,
      capacity_max_coils: input.capacityMaxCoils ?? null,
      capacity_max_wt_mt: input.capacityMaxWtMt ?? null,
      capacity_max_height_mm: input.capacityMaxHeightMm ?? null,
      soak_time_adj_hr: input.soakTimeAdjHr ?? 0,
      is_active: true,
    } as never).execute();
    return baseNo;
  }

  static async listAnnStoppageCategories() {
    return db.selectFrom('master.ann_stoppage_category').selectAll().orderBy('category_code', 'asc').execute();
  }

  /** ANN-only shift review aggregate — charges/stoppages/dew for one shift log. */
  static async getAnnShiftReview(shiftLogId: string) {
    const charges = await db.selectFrom('txn.ann_charge')
      .selectAll()
      .where('shift_log_id', '=', shiftLogId)
      .orderBy('charge_no', 'asc')
      .execute();

    const chargeNos = charges.map((c) => c.charge_no);
    const latestReading = new Map<string, Record<string, unknown>>();
    let stoppages: Array<Record<string, unknown>> = [];

    if (chargeNos.length > 0) {
      const readings = await db.selectFrom('txn.ann_charge_reading')
        .selectAll()
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

    const BUCKET: Record<string, string> = {
      BASE_FAN: 'Base / mechanical',
      BASE_SEAL: 'Base / mechanical',
      BASE_CLAMP: 'Base / mechanical',
      BASE_WATER: 'Base / mechanical',
      CA_BLOWER: 'Base / mechanical',
      THERMOCOUPLE: 'Instrumentation',
      POWER: 'Power',
      GAS_SUPPLY: 'Utilities',
      CRANE: 'Material handling',
      OTHER: 'Other',
    };
    const delayMap = new Map<string, number>();
    const remarks: string[] = [];
    for (const s of stoppages) {
      const code = String(s.category_code ?? 'OTHER');
      const bucket = BUCKET[code] ?? 'Other';
      const min = Number(s.duration_min ?? 0);
      delayMap.set(bucket, (delayMap.get(bucket) ?? 0) + (Number.isFinite(min) ? min : 0));
      const note = [s.reason, s.remark].filter(Boolean).join(' — ');
      if (note) remarks.push(`${s.charge_no}: ${note}`);
    }

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
      delaySummary: [...delayMap.entries()]
        .map(([bucket, minutes]) => ({ bucket, minutes: Math.round(minutes * 10) / 10 }))
        .sort((a, b) => b.minutes - a.minutes),
      remarks: remarks.join('; ') || null,
      crew: { opn: '—', helper: '—', signature: '—' },
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
      .selectAll()
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
        .selectAll()
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

  static async transitionAnnCharge(chargeNo: string, status: 'IN_PROCESS' | 'FOR_ANN' | 'RW' | 'DONE', extras?: { furnaceId?: number; dewPointN2?: number; dewPointH2?: number; temperatureDegc?: number }) {
    const charge = await db.selectFrom('txn.ann_charge')
      .select('status')
      .where('charge_no', '=', chargeNo)
      .executeTakeFirst();
    if (!charge) throw new Error(`ANN charge not found: ${chargeNo}`);

    // Idempotent transitions: re-saving the same status is a no-op.
    if (charge.status === status) return;

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
        console.error('[ANN fan-out] advanceJourneyByCoil failed', { err, coilNo: row.coil_no, chargeNo });
      }
    }
  }

  /** Σ non-skipped stage durations → total_active_min; idle = gaps between stages. */
  private static async refreshAnnTotals(chargeNo: string) {
    const stages = await db.selectFrom('txn.ann_charge_stage')
      .selectAll()
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
}
