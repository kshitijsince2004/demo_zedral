import { db } from '../db';
import type { Database } from '../db';
import type { Kysely } from 'kysely';
import { defaultSuggestedMachine } from '../utils/machineAllocation';
import type { SixHiSubProcess } from '@m1/shared-validation';

type DbConn = Kysely<Database>;

interface BatchRow {
  batch_id: number | string;
  batch_number: string;
  coil_no: string;
  plan_date: Date | string;
  shift_code: string;
  customer_name: string;
  grade_code: string;
  width_mm: number | string;
  ppc_thk_mm: number | string;
  ppc_weight_mt: number | string;
  destination: string | null;
  roll_finish: string | null;
  slit_id: string | null;
  sap_order_no: string | null;
}

interface JourneyStepRow {
  step_id: number | string;
  step_no: number;
  route_code: string;
  display_label: string;
  process_code: string | null;
  machine_code: string | null;
  sub_process: string | null;
  queue_batch_id: number | string | null;
}

interface CompletionPayload {
  outputThkMm?: number;
  actualWeightMt?: number;
  destination?: string;
  gradeCode?: string;
  widthMm?: number;
  customerName?: string;
  shiftCode?: string;
}

export class QueueTransferService {
  /** Create next queue entry for SixHi steps; returns batch_id or null for non-queue steps. */
  static async enqueueNextStep(
    journeyId: number,
    sourceStepId: number,
    nextStep: JourneyStepRow,
    sourceBatch: BatchRow,
    payload: CompletionPayload,
    conn: DbConn = db,
  ): Promise<number | null> {
    const genericCrm = nextStep.route_code === '4' || nextStep.route_code === 'X';
    
    if (!nextStep.machine_code && !genericCrm && nextStep.route_code !== 'PKG') {
      // For some reason, neither machine code nor generic CRM is specified, and it's not packaging
      await this.recordHandoff(journeyId, sourceStepId, nextStep.step_no, null, conn);
      return null;
    }

    if (nextStep.route_code === 'PKG') {
      // Packaging doesn't have a queue yet
      await this.recordHandoff(journeyId, sourceStepId, nextStep.step_no, null, conn);
      return null;
    }

    const queueSubProcess = (nextStep.sub_process
      ?? (nextStep.route_code === '4' ? 'ROLLING' : nextStep.route_code === 'X' ? 'SKIN_PASS' : nextStep.process_code)) as string;

    const targetMachine = nextStep.machine_code
      ?? (genericCrm ? defaultSuggestedMachine(queueSubProcess as SixHiSubProcess) : (nextStep.process_code ?? ''));

    if (nextStep.queue_batch_id) {
      const existingBatchId = Number(nextStep.queue_batch_id);
      await this.recordHandoff(journeyId, sourceStepId, nextStep.step_no, existingBatchId, conn);
      return existingBatchId;
    }

    const existing = await conn.selectFrom('planning.queue_handoff')
      .select('target_batch_id')
      .where('journey_id', '=', String(journeyId))
      .where('source_step_id', '=', String(sourceStepId))
      .where('target_step_no', '=', nextStep.step_no)
      .executeTakeFirst();
    if (existing?.target_batch_id) return Number(existing.target_batch_id);

    const batchNumber = `${sourceBatch.coil_no}-${nextStep.route_code}-${Date.now().toString(36).toUpperCase()}`;
    const inputThk = payload.outputThkMm ?? Number(sourceBatch.ppc_thk_mm);
    const weightMt = payload.actualWeightMt ?? Number(sourceBatch.ppc_weight_mt);
    const planDate = new Date();
    const shiftCode = payload.shiftCode ?? sourceBatch.shift_code;

    const maxSeq = await conn.selectFrom('planning.ppc_batch')
      .select(conn.fn.max('queue_seq').as('max_seq'))
      .where('plan_date', '=', planDate)
      .where('shift_code', '=', shiftCode)
      .where('machine_code', '=', targetMachine)
      .where('sub_process', '=', queueSubProcess)
      .executeTakeFirst();

    const queueSeq = (Number(maxSeq?.max_seq) || 0) + 1;

    const inserted = await conn.insertInto('planning.ppc_batch')
      .values({
        batch_number: batchNumber,
        plan_date: planDate,
        shift_code: shiftCode,
        machine_code: targetMachine,
        sub_process: queueSubProcess,
        machine_allocated: !!nextStep.machine_code,
        coil_no: sourceBatch.coil_no,
        slit_id: sourceBatch.slit_id,
        customer_name: payload.customerName ?? sourceBatch.customer_name,
        grade_code: payload.gradeCode ?? sourceBatch.grade_code,
        width_mm: payload.widthMm ?? Number(sourceBatch.width_mm),
        input_thk_mm: inputThk,
        ppc_thk_mm: inputThk,
        ppc_weight_mt: weightMt,
        destination: (payload.destination as 'REWINDING' | 'ANNEALING' | null) ?? sourceBatch.destination,
        roll_finish: sourceBatch.roll_finish,
        queue_seq: queueSeq,
        sap_order_no: sourceBatch.sap_order_no,
        process_route_raw: await this.getRouteRaw(journeyId, conn),
      })
      .returning('batch_id')
      .executeTakeFirstOrThrow();

    const batchId = Number(inserted.batch_id);

    await conn.updateTable('coil.coil')
      .set({
        status: 'PLANNED',
        coil_thk_mm: inputThk,
        weight_mt: weightMt,
        next_dest: nextStep.process_code,
      })
      .where('coil_no', '=', sourceBatch.coil_no)
      .execute();

    await this.recordHandoff(journeyId, sourceStepId, nextStep.step_no, batchId, conn);
    return batchId;
  }

  private static async getRouteRaw(journeyId: number, conn: DbConn = db): Promise<string | null> {
    const j = await conn.selectFrom('planning.order_journey')
      .select('route_raw')
      .where('journey_id', '=', String(journeyId))
      .executeTakeFirst();
    return j?.route_raw ?? null;
  }

  private static async recordHandoff(
    journeyId: number,
    sourceStepId: number,
    targetStepNo: number,
    targetBatchId: number | null,
    conn: DbConn = db,
  ) {
    await conn.insertInto('planning.queue_handoff')
      .values({
        journey_id: String(journeyId),
        source_step_id: String(sourceStepId),
        target_step_no: targetStepNo,
        target_batch_id: targetBatchId != null ? String(targetBatchId) : null,
        source: 'AUTO',
      })
      .onConflict((oc) => oc.columns(['journey_id', 'source_step_id', 'target_step_no']).doNothing())
      .execute();
  }
}
