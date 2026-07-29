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
  prefill?: Awaited<ReturnType<typeof AutoSourceService.resolvePrefill>>;
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
      cards.push({
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
      });
    }
    return cards;
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

  static async upsertPklChart(shiftLogId: string, chartTime: string, tanks: Array<{ tankNo: number; [key: string]: unknown }>) {
    for (const tank of tanks) {
      const existing = await db.selectFrom('txn.prod_pkl_chart').select('chart_id').where('shift_log_id', '=', shiftLogId).where('chart_time', '=', chartTime).where('tank_no', '=', tank.tankNo).executeTakeFirst();
      const values = { shift_log_id: shiftLogId, chart_time: chartTime, tank_no: tank.tankNo, tank_temp_degc: tank.tankTempDegc as number | undefined, acid_strength_pct: tank.acidStrengthPct as number | undefined };
      if (existing) await db.updateTable('txn.prod_pkl_chart').set(values).where('chart_id', '=', existing.chart_id).execute();
      else await db.insertInto('txn.prod_pkl_chart').values(values).execute();
    }
  }

  static async getAnnCharges() { return db.selectFrom('txn.ann_charge as ac').selectAll().orderBy('ac.charge_no', 'desc').execute(); }

  static async getAnnChargeDetail(chargeNo: string) {
    const charge = await db.selectFrom('txn.ann_charge').selectAll().where('charge_no', '=', chargeNo).executeTakeFirst();
    if (!charge) return null;
    const roster = await db.selectFrom('txn.ann_charge_coil as acc').innerJoin('coil.coil as c', 'c.coil_no', 'acc.coil_no').select(['acc.coil_no','acc.seq_no','c.grade_code','c.weight_mt']).where('acc.charge_no', '=', chargeNo).orderBy('acc.seq_no', 'asc').execute();
    return { charge, roster };
  }

  static async createAnnCharge(input: { chargeNo: string; baseNo?: string; shiftLogId: string; furnaceId?: number; gradeCode?: string }) {
    await db.insertInto('txn.ann_charge').values({ charge_no: input.chargeNo, base_no: input.baseNo ?? null, shift_log_id: input.shiftLogId, furnace_id: input.furnaceId ?? null, grade_code: input.gradeCode ?? null, status: 'IN_PROCESS', no_of_coils: 0, charge_wt_mt: 0 }).execute();
    return input.chargeNo;
  }

  static async rosterAnnCoil(chargeNo: string, coilNo: string, seqNo?: number) {
    const dup = await db.selectFrom('txn.ann_charge_coil').select('coil_no').where('charge_no', '=', chargeNo).where('coil_no', '=', coilNo).executeTakeFirst();
    if (!dup) await db.insertInto('txn.ann_charge_coil').values({ charge_no: chargeNo, coil_no: coilNo, seq_no: seqNo ?? null }).execute();
    await this.refreshAnnChargeDerived(chargeNo);
  }

  static async transitionAnnCharge(chargeNo: string, status: 'IN_PROCESS' | 'FOR_ANN' | 'RW' | 'DONE', extras?: { furnaceId?: number; dewPointN2?: number; dewPointH2?: number; temperatureDegc?: number }) {
    const charge = await db.selectFrom('txn.ann_charge')
      .select('status')
      .where('charge_no', '=', chargeNo)
      .executeTakeFirst();
    if (!charge) throw new Error(`ANN charge not found: ${chargeNo}`);

    // Idempotent transitions: re-saving the same status is a no-op.
    if (charge.status === status) return;

    // Guard state machine: IN_PROCESS → FOR_ANN → RW → DONE
    if (status === 'FOR_ANN' && charge.status !== 'IN_PROCESS') {
      throw new Error(`Invalid ANN charge transition: ${charge.status} → FOR_ANN`);
    }
    if (status === 'RW' && charge.status !== 'FOR_ANN') {
      throw new Error(`Invalid ANN charge transition: ${charge.status} → RW`);
    }
    if (status === 'DONE' && charge.status !== 'RW') {
      throw new Error(`Invalid ANN charge transition: ${charge.status} → DONE`);
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
      // Always refresh derived values from roster (Requirement 7.5).
      await this.refreshAnnChargeDerived(chargeNo);

      const roster = await db.selectFrom('txn.ann_charge_coil')
        .select('coil_no')
        .where('charge_no', '=', chargeNo)
        .execute();

      for (const row of roster) {
        // Idempotency per coil: only advance if the coil is currently at an ACTIVE ANN step.
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
  }

  private static async refreshAnnChargeDerived(chargeNo: string) {
    const roster = await db.selectFrom('txn.ann_charge_coil as acc').innerJoin('coil.coil as c', 'c.coil_no', 'acc.coil_no').select(['c.weight_mt']).where('acc.charge_no', '=', chargeNo).execute();
    const chargeWt = roster.reduce((sum, r) => sum + Number(r.weight_mt ?? 0), 0);
    await db.updateTable('txn.ann_charge').set({ no_of_coils: roster.length, charge_wt_mt: chargeWt }).where('charge_no', '=', chargeNo).execute();
  }
}
