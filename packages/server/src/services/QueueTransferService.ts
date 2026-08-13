import { db } from '../db';
import type { Database } from '../db';
import type { Kysely } from 'kysely';
import { defaultSuggestedMachine } from '../utils/machineAllocation';
import type { SixHiSubProcess } from '@m1/shared-validation';

type DbConn = Kysely<Database>;

export interface BatchRow {
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
  /** Resolve a step's queue target; null means the step gets no queue (no machine / packaging). */
  private static resolveQueueTarget(
    step: JourneyStepRow,
  ): { targetMachine: string; queueSubProcess: string } | null {
    const genericCrm = step.route_code === '4' || step.route_code === 'X';
    // Neither machine code nor generic CRM specified, and not packaging → no queue.
    if (!step.machine_code && !genericCrm && step.route_code !== 'PKG') return null;
    // Packaging doesn't have a queue yet.
    if (step.route_code === 'PKG') return null;

    const queueSubProcess = (step.sub_process
      ?? (step.route_code === '4' ? 'ROLLING' : step.route_code === 'X' ? 'SKIN_PASS' : step.process_code)) as string;
    const targetMachine = step.machine_code
      ?? (genericCrm ? defaultSuggestedMachine(queueSubProcess as SixHiSubProcess) : (step.process_code ?? ''));
    return { targetMachine, queueSubProcess };
  }

  /** Insert a ppc_batch queue row for `step` from `sourceBatch`, and update the coil. Returns batch_id. */
  private static async insertQueueBatch(
    journeyId: number,
    step: JourneyStepRow,
    sourceBatch: BatchRow,
    payload: CompletionPayload,
    targetMachine: string,
    queueSubProcess: string,
    conn: DbConn = db,
  ): Promise<number> {
    const batchNumber = `${sourceBatch.coil_no}-${step.route_code}-${Date.now().toString(36).toUpperCase()}`;
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
        machine_allocated: !!step.machine_code,
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
        next_dest: step.process_code,
      })
      .where('coil_no', '=', sourceBatch.coil_no)
      .execute();

    return batchId;
  }

  /** Create next queue entry for SixHi steps; returns batch_id or null for non-queue steps. */
  static async enqueueNextStep(
    journeyId: number,
    sourceStepId: number,
    nextStep: JourneyStepRow,
    sourceBatch: BatchRow,
    payload: CompletionPayload,
    conn: DbConn = db,
  ): Promise<number | null> {
    const target = this.resolveQueueTarget(nextStep);
    if (!target) {
      await this.recordHandoff(journeyId, sourceStepId, nextStep.step_no, null, conn);
      return null;
    }

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

    const batchId = await this.insertQueueBatch(
      journeyId, nextStep, sourceBatch, payload, target.targetMachine, target.queueSubProcess, conn,
    );

    await this.recordHandoff(journeyId, sourceStepId, nextStep.step_no, batchId, conn);
    return batchId;
  }

  /**
   * Fan-out variant: enqueue the ACTIVE step of a freshly-created child journey (e.g. an HRS
   * slit child whose first step is PKL). Without this the child journey has queue_batch_id = null
   * and never materialises in the PKL/HRS order queue (getQueue → ensureOrder throws "No PKL batch").
   * Idempotent: no-op (returns existing) if the active step already has a queue batch.
   */
  static async enqueueActiveStep(
    journeyId: number,
    sourceBatch: BatchRow,
    payload: CompletionPayload = {},
    conn: DbConn = db,
  ): Promise<number | null> {
    const step = await conn.selectFrom('planning.order_journey_step')
      .select(['step_id', 'step_no', 'route_code', 'display_label', 'process_code', 'machine_code', 'sub_process', 'queue_batch_id'])
      .where('journey_id', '=', String(journeyId))
      .where('status', '=', 'ACTIVE')
      .orderBy('step_no', 'asc')
      .executeTakeFirst();
    if (!step) return null;
    if (step.queue_batch_id) return Number(step.queue_batch_id);

    const target = this.resolveQueueTarget(step as JourneyStepRow);
    if (!target) return null;

    const batchId = await this.insertQueueBatch(
      journeyId, step as JourneyStepRow, sourceBatch, payload, target.targetMachine, target.queueSubProcess, conn,
    );

    await conn.updateTable('planning.order_journey_step')
      .set({ queue_batch_id: batchId })
      .where('step_id', '=', step.step_id)
      .execute();

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
