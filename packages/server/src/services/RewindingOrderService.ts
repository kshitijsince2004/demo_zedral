/**
 * Rewinding line order lifecycle over txn.rwd_order.
 * Mirrors SixHiService behaviour; does not touch txn.crm_order.
 */
import { randomUUID } from 'node:crypto';
import { allocateCombinedRemainderToBlanks, formatPlantDate, postgresDateOnly } from '@m1/shared-validation';
import { db } from '../db';
import { getTenantId } from '../context';
import { ShiftDetectionService } from './ShiftDetectionService';
import { MachineStateEventService } from './MachineStateEventService';
import { resolveStoppageMinutes } from '../validation/manufacturingValidation';
import { formatDisplayCoilNo, mapPlanSurfaceToCode } from '../utils/rwdFieldMappers';
import {
  assertCanAddStoppage,
  assertCombineEligible,
  assertRejectPayload,
  healOrphanStoppageStatus,
  netProdDurationMin,
  statusAfterUngroupCombine,
} from '../utils/orderLifecycleHelpers';
import {
  assertRewindingMachine,
  belongsOnRewindingDesk,
  isRewindingPpcBatch,
  parseRewindingMachineCode,
  REWINDING_MACHINES,
  type RewindingMachineCode,
} from '../utils/rewindingMachines';
import { ProductionService } from '../modules/m1-collection/services/ProductionService';
import { assertMachineClaimOrIdempotent } from '../utils/machineAllocation';
import { throwVersionConflict } from '../utils/versionConflict';
import { logger } from '../utils/logger';

export type RwdOrderStatus =
  | 'PENDING'
  | 'PREPARING'
  | 'IN_PROGRESS'
  | 'STOPPAGE'
  | 'COMPLETED'
  | 'REJECTED';

export type RwdOrderDetail = {
  orderId: string;
  batchNumber: string;
  batchId: string;
  coilNo: string;
  displayCoilNo: string;
  slitId?: string;
  customerName: string;
  gradeCode: string;
  widthMm: number;
  inputThkMm?: number;
  ppcThkMm: number;
  ppcWeightMt: number;
  machineCode: string;
  machineAllocated: boolean;
  status: RwdOrderStatus;
  combinedGroupId?: string;
  prodStartAt?: string;
  prodEndAt?: string;
  prodDurationMin?: number;
  shiftLogId?: string;
  shiftCode?: string;
  surfaceFinish?: 'M' | 'B';
  /** Latest txn.prod_rwd capture (if any). */
  finishWeightMt?: number;
  rwTension1Kg?: number;
  rwTension2Kg?: number;
  rwTension3Kg?: number;
  outputThkMm?: number;
  holdReason?: string;
  holdRemarks?: string;
  stoppages: Array<{
    stoppageId: string;
    categoryCode: string;
    breakdownCode?: string;
    startAt: string;
    endAt?: string;
    durationMin?: number;
    remarks?: string;
  }>;
  activeStoppageId?: string;
};

type RwdCapturePayload = {
  weightMt?: number;
  rwTension1Kg?: number;
  rwTension2Kg?: number;
  rwTension3Kg?: number;
  outputThkMm?: number;
  surfaceFinish?: string;
  remarks?: string;
  complete?: boolean;
};

export type RwdQueueCard = {
  batchNumber: string;
  coilNo: string;
  displayCoilNo: string;
  slitId?: string;
  customerName: string;
  gradeCode: string;
  widthMm: number;
  thicknessMm: number;
  weightMt: number;
  surfaceFinish?: 'M' | 'B';
  planDate?: string;
  shiftCode?: string;
  status: RwdOrderStatus;
  machineCode: string;
  machineAllocated: boolean;
  combinedGroupId?: string;
};

const RWD_PROCESS_CODE = 'RWD';

function formatPlanDate(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export class RewindingOrderService {
  static async getProcessId(): Promise<number> {
    const row = await db
      .selectFrom('master.process')
      .select('process_id')
      .where('code', '=', RWD_PROCESS_CODE)
      .executeTakeFirstOrThrow();
    return Number(row.process_id);
  }

  static async ensureActiveShiftLog(
    userId: number,
    planDate?: string | Date,
    shiftCode?: string,
  ): Promise<string> {
    const processId = await this.getProcessId();
    const resolved = await ShiftDetectionService.resolveShift({
      planDate: planDate != null ? postgresDateOnly(planDate) : formatPlantDate(new Date()),
      shiftCode: shiftCode ?? 'B',
      processId,
      userId,
    });
    return resolved.shiftLogId;
  }

  /** Ensure rwd_order row exists for a rewinding ppc_batch. */
  static async ensureOrder(batchNumber: string, userId: number): Promise<string> {
    const batch = await db
      .selectFrom('planning.ppc_batch')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch) throw new Error(`Batch not found: ${batchNumber}`);
    if (!isRewindingPpcBatch(batch)) {
      throw new Error(`Batch ${batchNumber} is not a rewinding order`);
    }

    const existing = await db
      .selectFrom('txn.rwd_order')
      .select('order_id')
      .where('batch_id', '=', batch.batch_id)
      .executeTakeFirst();
    if (existing) return String(existing.order_id);

    const machine = assertRewindingMachine(batch.machine_code);
    const detected = await ShiftDetectionService.getCurrentShift({
      userId,
      machineCode: machine,
    });
    const prodDate = postgresDateOnly(detected.prodDate);
    const activeShift = detected.shiftCode.toUpperCase();
    const shiftLogId = await this.ensureActiveShiftLog(userId, prodDate, activeShift);
    const inputThk = Number(batch.input_thk_mm ?? batch.ppc_thk_mm);

    await db
      .insertInto('coil.coil')
      .values({
        coil_no: batch.coil_no,
        grade_code: batch.grade_code,
        nominal_width_mm: batch.width_mm,
        coil_thk_mm: inputThk,
        weight_mt: batch.ppc_weight_mt,
        status: 'PLANNED',
      })
      .onConflict((oc) => oc.column('coil_no').doNothing())
      .execute();

    const order = await db
      .insertInto('txn.rwd_order')
      .values({
        shift_log_id: shiftLogId,
        batch_id: batch.batch_id,
        batch_number: batch.batch_number,
        coil_no: batch.coil_no,
        slit_id: batch.slit_id,
        customer_name: batch.customer_name,
        grade_code: batch.grade_code,
        width_mm: batch.width_mm,
        input_thk_mm: inputThk,
        ppc_thk_mm: batch.ppc_thk_mm,
        ppc_weight_mt: batch.ppc_weight_mt,
        machine_code: machine,
        status: batch.machine_allocated ? 'PREPARING' : 'PENDING',
        logged_in_user_id: userId,
        production_day: prodDate,
        shift_code: activeShift,
        prod_date: prodDate,
      } as any)
      .returning('order_id')
      .executeTakeFirstOrThrow();

    return String(order.order_id);
  }

  static async getOrder(batchNumber: string, userId: number): Promise<RwdOrderDetail> {
    await this.ensureOrder(batchNumber, userId);
    return this.loadOrderDetail(batchNumber);
  }

  /** GET-safe: no ensureOrder side effect. */
  static async getExistingOrder(batchNumber: string): Promise<RwdOrderDetail | null> {
    const row = await db
      .selectFrom('txn.rwd_order')
      .select('order_id')
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!row) return null;
    return this.loadOrderDetail(batchNumber);
  }

  /** Plan-only detail when rwd_order row does not exist yet (MH pending cards). */
  static async getPlanOrderDetail(batchNumber: string): Promise<RwdOrderDetail | null> {
    const pb = await db
      .selectFrom('planning.ppc_batch')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!pb) return null;
    if (!isRewindingPpcBatch(pb)) return null;
    const machine = String(pb.machine_code ?? 'RWD').toUpperCase();
    const thk = Number(pb.input_thk_mm ?? pb.ppc_thk_mm ?? 0);
    return {
      orderId: '',
      batchNumber: pb.batch_number,
      batchId: String(pb.batch_id),
      coilNo: pb.coil_no,
      displayCoilNo: formatDisplayCoilNo(pb.coil_no, pb.slit_id),
      slitId: pb.slit_id ?? undefined,
      customerName: pb.customer_name ?? '-',
      gradeCode: pb.grade_code ?? '-',
      widthMm: Number(pb.width_mm ?? 0),
      inputThkMm: pb.input_thk_mm != null ? Number(pb.input_thk_mm) : undefined,
      ppcThkMm: Number(pb.ppc_thk_mm ?? thk),
      ppcWeightMt: Number(pb.ppc_weight_mt ?? 0),
      machineCode: machine,
      machineAllocated: Boolean(pb.machine_allocated),
      status: 'PENDING',
      surfaceFinish: mapPlanSurfaceToCode(pb.roll_finish) ?? undefined,
      stoppages: [],
    };
  }

  private static async latestProdRwd(coilNo: string) {
    return db
      .selectFrom('txn.prod_rwd')
      .select([
        'weight_mt',
        'rw_tension_1_kg',
        'rw_tension_2_kg',
        'rw_tension_3_kg',
        'output_thk_mm',
        'surface_finish',
      ])
      .where('coil_no', '=', coilNo)
      .orderBy('entry_id', 'desc')
      .executeTakeFirst();
  }

  /** Read machine without creating an order — for allocate auth. */
  static async peekOrderMachine(batchNumber: string): Promise<{
    machineCode: string | null;
    machineAllocated: boolean;
  }> {
    const row = await db
      .selectFrom('planning.ppc_batch')
      .select(['machine_code', 'machine_allocated'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    return {
      machineCode: row?.machine_code ? String(row.machine_code).toUpperCase() : null,
      machineAllocated: Boolean(row?.machine_allocated),
    };
  }

  private static async loadOrderDetail(batchNumber: string): Promise<RwdOrderDetail> {
    const order = await db
      .selectFrom('txn.rwd_order')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!order) throw new Error(`Order not found: ${batchNumber}`);

    const ppc = await db
      .selectFrom('planning.ppc_batch')
      .select(['machine_allocated', 'roll_finish'])
      .where('batch_id', '=', order.batch_id)
      .executeTakeFirst();

    const stoppages = await db
      .selectFrom('txn.stoppage')
      .select([
        'stoppage_id',
        'category_code',
        'breakdown_code',
        'start_at',
        'end_at',
        'duration_min',
        'remarks',
      ])
      .where('rwd_order_id', '=', order.order_id)
      .where('order_kind', '=', 'RWD')
      .orderBy('start_at', 'desc')
      .execute();

    const active = stoppages.find((s) => !s.end_at);
    let status = order.status as RwdOrderStatus;
    if (status === 'STOPPAGE' && !active) {
      // Heal orphan STOPPAGE — prefer PREPARING when allocated but never started.
      status = healOrphanStoppageStatus({
        status,
        hasActiveStoppage: false,
        prodStartAt: order.prod_start_at,
        machineAllocated: !!ppc?.machine_allocated,
      }) as RwdOrderStatus;
      await db
        .updateTable('txn.rwd_order')
        .set({ status, updated_at: new Date() })
        .where('order_id', '=', order.order_id)
        .where('status', '=', 'STOPPAGE')
        .execute();
    }

    const prod = await this.latestProdRwd(order.coil_no);

    return {
      orderId: String(order.order_id),
      batchNumber: order.batch_number,
      batchId: String(order.batch_id),
      coilNo: order.coil_no,
      displayCoilNo: formatDisplayCoilNo(order.coil_no, order.slit_id),
      slitId: order.slit_id ?? undefined,
      customerName: order.customer_name,
      gradeCode: order.grade_code,
      widthMm: Number(order.width_mm),
      inputThkMm: order.input_thk_mm != null ? Number(order.input_thk_mm) : undefined,
      ppcThkMm: Number(order.ppc_thk_mm),
      ppcWeightMt: Number(order.ppc_weight_mt),
      machineCode: order.machine_code,
      machineAllocated: ppc?.machine_allocated ?? true,
      status,
      combinedGroupId: order.combined_group_id ? String(order.combined_group_id) : undefined,
      prodStartAt: order.prod_start_at ? new Date(order.prod_start_at).toISOString() : undefined,
      prodEndAt: order.prod_end_at ? new Date(order.prod_end_at).toISOString() : undefined,
      prodDurationMin: order.prod_duration_min ?? undefined,
      shiftLogId: order.shift_log_id != null ? String(order.shift_log_id) : undefined,
      shiftCode: order.shift_code ?? undefined,
      surfaceFinish:
        mapPlanSurfaceToCode(prod?.surface_finish) ??
        mapPlanSurfaceToCode(ppc?.roll_finish) ??
        undefined,
      finishWeightMt: prod?.weight_mt != null ? Number(prod.weight_mt) : undefined,
      rwTension1Kg: prod?.rw_tension_1_kg != null ? Number(prod.rw_tension_1_kg) : undefined,
      rwTension2Kg: prod?.rw_tension_2_kg != null ? Number(prod.rw_tension_2_kg) : undefined,
      rwTension3Kg: prod?.rw_tension_3_kg != null ? Number(prod.rw_tension_3_kg) : undefined,
      outputThkMm: prod?.output_thk_mm != null ? Number(prod.output_thk_mm) : undefined,
      holdReason: order.hold_reason ?? undefined,
      holdRemarks: order.hold_remarks ?? undefined,
      stoppages: stoppages.map((s) => ({
        stoppageId: String(s.stoppage_id),
        categoryCode: s.category_code,
        breakdownCode: s.breakdown_code ?? undefined,
        startAt: new Date(s.start_at).toISOString(),
        endAt: s.end_at ? new Date(s.end_at).toISOString() : undefined,
        durationMin: s.duration_min ?? undefined,
        remarks: s.remarks ?? undefined,
      })),
      activeStoppageId: active ? String(active.stoppage_id) : undefined,
    };
  }

  static async getQueue(
    machineCode: string,
    opts?: { backfillUserId?: number },
  ): Promise<{ machineCode: string; queue: RwdQueueCard[] }> {
    const machine = assertRewindingMachine(machineCode);
    // RWD desk: imported/seeds on machine RWD. 2HI rewinding desk: already on 2HI, OR
    // unallocated rewinding-line plans (from_work_center=R still coded RWD until MTP assigns 2HI).
    let query = db
      .selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.rwd_order as o', 'o.batch_id', 'pb.batch_id')
      .select([
        'pb.batch_number',
        'pb.coil_no',
        'pb.slit_id',
        'pb.customer_name',
        'pb.grade_code',
        'pb.width_mm',
        'pb.input_thk_mm',
        'pb.ppc_thk_mm',
        'pb.ppc_weight_mt',
        'pb.roll_finish',
        'pb.plan_date',
        'pb.shift_code',
        'pb.machine_code',
        'pb.machine_allocated',
        'o.order_id',
        'o.status',
        'o.combined_group_id',
      ]);

    // Rewinding line only — destination REWINDING or sub_process RWD/REWINDING on RWD|2HI.
    query = query
      .where('pb.machine_code', 'in', ['RWD', '2HI'])
      .where((eb) =>
        eb.or([
          eb('pb.destination', '=', 'REWINDING'),
          eb('pb.sub_process', 'in', ['RWD', 'REWINDING']),
        ]),
      );

    const rows = await query
      .orderBy('pb.queue_seq', 'asc')
      .orderBy('pb.batch_number', 'asc')
      .execute();

    const deskRows = rows.filter((b) => belongsOnRewindingDesk(machine, b));

    if (opts?.backfillUserId) {
      const missing = deskRows.filter((r) => r.order_id == null).map((r) => r.batch_number);
      if (missing.length > 0) {
        for (const batchNumber of missing) {
          try {
            await this.ensureOrder(batchNumber, opts.backfillUserId);
          } catch (err) {
            logger.warn(`rewinding.ensureMissingQueueOrder ${batchNumber}:`, err);
          }
        }
        return this.getQueue(machineCode);
      }
    }

    return {
      machineCode: machine,
      queue: deskRows.map((b) => {
        const thk = b.input_thk_mm ?? b.ppc_thk_mm;
        return {
          batchNumber: b.batch_number,
          coilNo: b.coil_no,
          displayCoilNo: formatDisplayCoilNo(b.coil_no, b.slit_id),
          slitId: b.slit_id ?? undefined,
          customerName: b.customer_name ?? '-',
          gradeCode: b.grade_code ?? '-',
          widthMm: Number(b.width_mm ?? 0),
          thicknessMm: Number(thk ?? 0),
          weightMt: Number(b.ppc_weight_mt ?? 0),
          surfaceFinish: mapPlanSurfaceToCode(b.roll_finish) ?? undefined,
          planDate: formatPlanDate(b.plan_date),
          shiftCode: b.shift_code ?? undefined,
          status: (b.status as RwdOrderStatus) ?? 'PENDING',
          machineCode: b.machine_code,
          machineAllocated: b.machine_allocated ?? false,
          combinedGroupId: b.combined_group_id ? String(b.combined_group_id) : undefined,
        };
      }),
    };
  }

  static async allocateMachine(
    batchNumber: string,
    machineCode: string,
    userId: number,
  ): Promise<RwdOrderDetail> {
    const machine = assertRewindingMachine(machineCode);
    const batch = await db
      .selectFrom('planning.ppc_batch')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch) throw new Error(`Batch not found: ${batchNumber}`);
    if (!isRewindingPpcBatch(batch)) {
      throw new Error(`Batch ${batchNumber} is not a rewinding order`);
    }

    const claim = assertMachineClaimOrIdempotent(
      { batchNumber, machine_code: batch.machine_code, machine_allocated: batch.machine_allocated },
      machine,
    );
    if (claim === 'idempotent') return this.getOrder(batchNumber, userId);

    const order = await db
      .selectFrom('txn.rwd_order')
      .select(['order_id', 'status'])
      .where('batch_id', '=', batch.batch_id)
      .executeTakeFirst();
    if (order && !['PENDING', 'PREPARING'].includes(order.status)) {
      throw new Error('Cannot change machine allocation while order is in production');
    }

    await this.ensureOrder(batchNumber, userId);

    await db.transaction().execute(async (trx) => {
      const maxSeq = await trx
        .selectFrom('planning.ppc_batch')
        .select(trx.fn.max('queue_seq').as('max_seq'))
        .where('machine_code', '=', machine)
        .where('from_work_center', '=', 'R')
        .where('machine_allocated', '=', true)
        .executeTakeFirst();
      const queueSeq = (Number(maxSeq?.max_seq) || 0) + 1;

      const result = await trx
        .updateTable('planning.ppc_batch')
        .set({
          machine_code: machine,
          machine_allocated: true,
          queue_seq: queueSeq,
        })
        .where('batch_id', '=', batch.batch_id)
        .where((eb) => eb.or([
          eb('machine_allocated', '=', false),
          eb('machine_code', '=', machine),
        ]))
        .executeTakeFirst();

      if (Number(result.numUpdatedRows ?? 0) === 0) {
        const cur = await trx
          .selectFrom('planning.ppc_batch')
          .select(['batch_number', 'machine_code', 'machine_allocated'])
          .where('batch_id', '=', batch.batch_id)
          .executeTakeFirst();
        if (cur?.machine_allocated && cur.machine_code === machine) return;
        throwVersionConflict({
          batchNumber: cur?.batch_number ?? batchNumber,
          machineCode: cur?.machine_code ?? null,
          machineAllocated: cur?.machine_allocated ?? true,
        });
      }

      await trx
        .updateTable('txn.rwd_order')
        .set({
          machine_code: machine,
          status: 'PREPARING',
          updated_at: new Date(),
        })
        .where('batch_id', '=', batch.batch_id)
        .where('status', 'in', ['PENDING', 'PREPARING'])
        .execute();
    });

    return this.getOrder(batchNumber, userId);
  }

  private static async totalStoppageMinutes(orderId: string | number, asOf?: Date): Promise<number> {
    const rows = await db
      .selectFrom('txn.stoppage')
      .select(['start_at', 'end_at', 'duration_min'])
      .where('rwd_order_id', '=', orderId as any)
      .where('order_kind', '=', 'RWD')
      .execute();
    let total = 0;
    const now = asOf ?? new Date();
    for (const s of rows) {
      total += resolveStoppageMinutes(s.start_at, s.end_at ?? now, s.duration_min, now.getTime());
    }
    return total;
  }

  private static async assertNoOpenStoppage(orderId: string | number) {
    const open = await db
      .selectFrom('txn.stoppage')
      .select('stoppage_id')
      .where('rwd_order_id', '=', orderId as any)
      .where('order_kind', '=', 'RWD')
      .where('end_at', 'is', null)
      .executeTakeFirst();
    if (open) throw new Error('Close open stoppage before continuing');
  }

  private static async findActiveMachineOrder(machineCode: string) {
    return db
      .selectFrom('txn.rwd_order')
      .select(['batch_number', 'order_id', 'status'])
      .where('machine_code', '=', machineCode)
      .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .executeTakeFirst()
      .then((r) =>
        r
          ? { batchNumber: r.batch_number, orderId: r.order_id, status: r.status }
          : null,
      );
  }

  private static async loadCombinedGroupMembers(
    combinedGroupId: string,
    statuses?: string[],
  ) {
    let q = db
      .selectFrom('txn.rwd_order')
      .select(['order_id', 'batch_number', 'status', 'coil_no', 'prod_start_at'])
      .where('combined_group_id', '=', combinedGroupId);
    if (statuses?.length) q = q.where('status', 'in', statuses);
    return q.execute();
  }

  static async startProduction(batchNumber: string, userId: number): Promise<RwdOrderDetail> {
    let batch = await db
      .selectFrom('planning.ppc_batch')
      .select(['machine_code', 'machine_allocated', 'shift_code'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch?.machine_allocated) {
      // ponytail: machine already chosen (RWD/2HI) but flag false — flip via allocate; else require hub pick
      const known = parseRewindingMachineCode(String(batch?.machine_code ?? ''));
      if (!known) throw new Error('Assign a production machine before starting');
      await this.allocateMachine(batchNumber, known, userId);
      batch = await db
        .selectFrom('planning.ppc_batch')
        .select(['machine_code', 'machine_allocated', 'shift_code'])
        .where('batch_number', '=', batchNumber)
        .executeTakeFirst();
    }
    if (!batch?.machine_code) throw new Error(`Batch not found: ${batchNumber}`);
    const machineCode = assertRewindingMachine(batch.machine_code);
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);

    const active = await this.findActiveMachineOrder(machineCode);
    if (active && active.batchNumber !== batchNumber) {
      throw new Error(`ACTIVE_ORDER_CONFLICT:${active.batchNumber}`);
    }

    const orderId = await this.ensureOrder(batchNumber, userId);
    const orderRow = await db
      .selectFrom('txn.rwd_order')
      .select(['order_id', 'status', 'coil_no', 'prod_start_at', 'combined_group_id'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();

    if (orderRow.status === 'IN_PROGRESS') return this.getOrder(batchNumber, userId);

    if (orderRow.status === 'STOPPAGE') {
      await this.assertNoOpenStoppage(orderId);
      let resumeTargets = [{ order_id: orderId, batch_number: batchNumber }];
      if (orderRow.combined_group_id) {
        const siblings = await this.loadCombinedGroupMembers(String(orderRow.combined_group_id), [
          'STOPPAGE',
          'IN_PROGRESS',
        ]);
        for (const s of siblings) {
          if (s.status === 'STOPPAGE') await this.assertNoOpenStoppage(s.order_id);
        }
        resumeTargets = siblings.map((s) => ({
          order_id: String(s.order_id),
          batch_number: String(s.batch_number),
        }));
      }
      await db.transaction().execute(async (trx) => {
        for (const t of resumeTargets) {
          await trx
            .updateTable('txn.rwd_order')
            .set({ status: 'IN_PROGRESS', updated_at: new Date() })
            .where('order_id', '=', t.order_id as any)
            .where('status', '=', 'STOPPAGE')
            .execute();
        }
      });
      MachineStateEventService.recordEvent(machineCode, 'RUNNING_STARTED', {
        orderId,
        batchNumber,
        operatorId: userId,
        shiftCode: batch.shift_code,
      }).catch(() => undefined);
      return this.getOrder(batchNumber, userId);
    }

    if (orderRow.status !== 'PENDING' && orderRow.status !== 'PREPARING') {
      throw new Error('Only pending or preparing orders can be started');
    }

    // ponytail: re-check occupancy inside txn (no FOR UPDATE in kysely usage); shrinks start races.
    await db.transaction().execute(async (trx) => {
      const conflict = await trx
        .selectFrom('txn.rwd_order')
        .select('batch_number')
        .where('machine_code', '=', machineCode)
        .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
        .executeTakeFirst();
      if (conflict && String(conflict.batch_number) !== batchNumber) {
        throw new Error(`ACTIVE_ORDER_CONFLICT:${conflict.batch_number}`);
      }
      await trx
        .updateTable('txn.rwd_order')
        .set({
          status: 'IN_PROGRESS',
          prod_start_at: orderRow.prod_start_at ?? new Date(),
          updated_at: new Date(),
        })
        .where('order_id', '=', orderId as any)
        .where('status', 'in', ['PENDING', 'PREPARING'])
        .execute();
    });

    await db
      .updateTable('coil.coil')
      .set({ status: 'IN_PROCESS' })
      .where('coil_no', '=', orderRow.coil_no)
      .execute();

    MachineStateEventService.recordEvent(machineCode, 'RUNNING_STARTED', {
      orderId,
      batchNumber,
      operatorId: userId,
      shiftCode: batch.shift_code,
    }).catch(() => undefined);

    return this.getOrder(batchNumber, userId);
  }

  static async startCombinedProduction(
    batchNumbers: string[],
    userId: number,
    opts?: { mode?: 'prepare' | 'start' },
  ): Promise<RwdOrderDetail[]> {
    const mode = opts?.mode === 'prepare' ? 'prepare' : 'start';
    const unique = Array.from(new Set(batchNumbers.map((b) => b.trim()).filter(Boolean)));
    if (unique.length === 0) throw new Error('At least one order is required');

    const batches = await db
      .selectFrom('planning.ppc_batch')
      .select([
        'batch_number',
        'coil_no',
        'slit_id',
        'roll_finish',
        'machine_code',
        'machine_allocated',
      ])
      .where('batch_number', 'in', unique)
      .execute();
    if (batches.length !== unique.length) {
      throw new Error('One or more selected orders were not found');
    }

    assertCombineEligible(
      batches.map((b) => ({
        machineCode: b.machine_code,
        machineAllocated: !!b.machine_allocated,
        coilNo: b.coil_no,
        slitId: b.slit_id,
        rollFinish: b.roll_finish,
      })),
    );

    const machineCode = assertRewindingMachine(batches[0].machine_code);
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);

    const startRows: Array<{
      batchNumber: string;
      orderId: string;
      status: string;
      coilNo: string;
      combinedGroupId: string | null;
    }> = [];
    for (const bn of unique) {
      const orderId = await this.ensureOrder(bn, userId);
      const row = await db
        .selectFrom('txn.rwd_order')
        .select(['order_id', 'status', 'coil_no', 'combined_group_id'])
        .where('order_id', '=', orderId as any)
        .executeTakeFirstOrThrow();
      startRows.push({
        batchNumber: bn,
        orderId: String(row.order_id),
        status: row.status,
        coilNo: row.coil_no,
        combinedGroupId: row.combined_group_id ? String(row.combined_group_id) : null,
      });
    }

    const existingGroupId = startRows.map((r) => r.combinedGroupId).find(Boolean) ?? null;
    const groupId = unique.length > 1 ? (existingGroupId ?? randomUUID()) : null;
    const stamp = new Date();

    // Hub combine → PREPARING only; Start on capture actually runs.
    if (mode === 'prepare') {
      for (const row of startRows) {
        if (row.status !== 'PENDING' && row.status !== 'PREPARING') {
          throw new Error('Only pending or preparing orders can be combined into preparing');
        }
      }
      await db.transaction().execute(async (trx) => {
        for (const row of startRows) {
          await trx
            .updateTable('txn.rwd_order')
            .set({
              status: 'PREPARING',
              updated_at: stamp,
              ...(groupId ? { combined_group_id: groupId } : {}),
            })
            .where('order_id', '=', row.orderId as any)
            .execute();
        }
      });
      return Promise.all(unique.map((bn) => this.getOrder(bn, userId)));
    }

    const active = await this.findActiveMachineOrder(machineCode);
    if (active && !unique.includes(active.batchNumber)) {
      throw new Error(`ACTIVE_ORDER_CONFLICT:${active.batchNumber}`);
    }

    const statuses = startRows.map((r) => r.status);
    const isResume =
      statuses.every((s) => s === 'STOPPAGE' || s === 'IN_PROGRESS') &&
      statuses.some((s) => s === 'STOPPAGE');
    const isFresh = statuses.every((s) => s === 'PENDING' || s === 'PREPARING' || s === 'IN_PROGRESS');
    if (!isResume && !isFresh) {
      throw new Error('Only pending, preparing, or stoppage (resume) orders can be started together');
    }
    if (isResume) {
      for (const row of startRows) {
        if (row.status === 'STOPPAGE') await this.assertNoOpenStoppage(row.orderId);
      }
    }

    const startedAt = stamp;

    await db.transaction().execute(async (trx) => {
      for (const row of startRows) {
        if (row.status === 'IN_PROGRESS') {
          if (groupId) {
            await trx
              .updateTable('txn.rwd_order')
              .set({ combined_group_id: groupId, updated_at: startedAt })
              .where('order_id', '=', row.orderId as any)
              .execute();
          }
          continue;
        }
        if (isResume && row.status === 'STOPPAGE') {
          await trx
            .updateTable('txn.rwd_order')
            .set({
              status: 'IN_PROGRESS',
              updated_at: startedAt,
              ...(groupId ? { combined_group_id: groupId } : {}),
            })
            .where('order_id', '=', row.orderId as any)
            .execute();
          continue;
        }
        await trx
          .updateTable('txn.rwd_order')
          .set({
            status: 'IN_PROGRESS',
            prod_start_at: startedAt,
            updated_at: startedAt,
            ...(groupId ? { combined_group_id: groupId } : {}),
          })
          .where('order_id', '=', row.orderId as any)
          .execute();
        await trx
          .updateTable('coil.coil')
          .set({ status: 'IN_PROCESS' })
          .where('coil_no', '=', row.coilNo)
          .execute();
      }
    });

    return Promise.all(unique.map((bn) => this.getOrder(bn, userId)));
  }

  /** Dissolve PREPARING combined groups; no-op when batches have no group. */
  static async cancelCombinedProduction(
    batchNumbers: string[],
    userId: number,
  ): Promise<RwdOrderDetail[]> {
    const unique = Array.from(new Set(batchNumbers.map((b) => b.trim()).filter(Boolean)));
    if (unique.length === 0) throw new Error('At least one order is required');

    const seedRows = await db
      .selectFrom('txn.rwd_order')
      .select(['batch_number', 'combined_group_id', 'status', 'prod_start_at'])
      .where('batch_number', 'in', unique)
      .execute();

    const groupIds = Array.from(
      new Set(
        seedRows
          .map((r) => (r.combined_group_id ? String(r.combined_group_id) : null))
          .filter((id): id is string => !!id),
      ),
    );

    if (groupIds.length === 0) {
      return Promise.all(unique.map((bn) => this.getOrder(bn, userId)));
    }

    const members = await db
      .selectFrom('txn.rwd_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([
        'o.order_id',
        'o.batch_number',
        'o.status',
        'o.prod_start_at',
        'o.combined_group_id',
        'pb.machine_allocated',
      ])
      .where('o.combined_group_id', 'in', groupIds)
      .execute();

    for (const row of members) {
      if (row.status !== 'PENDING' && row.status !== 'PREPARING') {
        throw new Error('Cannot cancel combined order after production has started — use Hold or End');
      }
      if (row.prod_start_at) {
        throw new Error('Cannot cancel combined order after production has started — use Hold or End');
      }
    }

    const stamp = new Date();
    await db.transaction().execute(async (trx) => {
      for (const row of members) {
        const nextStatus = statusAfterUngroupCombine(!!row.machine_allocated);
        await trx
          .updateTable('txn.rwd_order')
          .set({
            combined_group_id: null,
            status: nextStatus,
            updated_at: stamp,
          })
          .where('order_id', '=', row.order_id as any)
          .execute();
      }
    });

    const affected = Array.from(new Set([...unique, ...members.map((m) => m.batch_number)]));
    return Promise.all(affected.map((bn) => this.getOrder(bn, userId)));
  }

  static async endProduction(batchNumber: string, userId: number): Promise<RwdOrderDetail> {
    const order = await db
      .selectFrom('txn.rwd_order')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirstOrThrow();
    if (order.status !== 'IN_PROGRESS' && order.status !== 'STOPPAGE') {
      throw new Error('Only running orders can be completed');
    }

    let targets = [{ batch_number: batchNumber, order_id: order.order_id, coil_no: order.coil_no }];
    if (order.combined_group_id) {
      const groupRows = await db
        .selectFrom('txn.rwd_order')
        .select(['batch_number', 'order_id', 'coil_no'])
        .where('combined_group_id', '=', order.combined_group_id)
        .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
        .execute();
      if (groupRows.length) {
        targets = groupRows.map((r) => ({
          batch_number: String(r.batch_number),
          order_id: r.order_id,
          coil_no: r.coil_no,
        }));
      }
    }

    for (const t of targets) await this.assertNoOpenStoppage(t.order_id);

    // G2: End without Save leaves journey stuck at R and no prod_rwd.
    for (const t of targets) {
      const prod = await this.latestProdRwd(t.coil_no);
      if (!prod) {
        throw new Error(`Save production data before ending order ${t.batch_number}`);
      }
    }

    const endAt = new Date();
    await db.transaction().execute(async (trx) => {
      for (const t of targets) {
        const row = await trx
          .selectFrom('txn.rwd_order')
          .select(['prod_start_at', 'coil_no', 'machine_code'])
          .where('order_id', '=', t.order_id as any)
          .executeTakeFirstOrThrow();
        const stopMin = await this.totalStoppageMinutes(t.order_id, endAt);
        const duration = row.prod_start_at
          ? netProdDurationMin(new Date(row.prod_start_at), endAt, stopMin)
          : 0;
        await trx
          .updateTable('txn.rwd_order')
          .set({
            status: 'COMPLETED',
            prod_end_at: endAt,
            prod_duration_min: duration,
            updated_at: endAt,
          })
          .where('order_id', '=', t.order_id as any)
          .execute();
        await trx
          .updateTable('coil.coil')
          .set({ status: 'DONE' })
          .where('coil_no', '=', row.coil_no)
          .execute();
      }
    });

    MachineStateEventService.recordEvent(order.machine_code, 'RUNNING_ENDED', {
      orderId: order.order_id,
      batchNumber,
      operatorId: userId,
      shiftCode: order.shift_code ?? undefined,
    }).catch(() => undefined);

    return this.getOrder(batchNumber, userId);
  }

  /** Capture prod_rwd linked to order shift; optionally complete. */
  static async capture(
    batchNumber: string,
    userId: number,
    data: RwdCapturePayload,
  ): Promise<RwdOrderDetail> {
    const order = await this.getOrder(batchNumber, userId);
    if (!order.shiftLogId) throw new Error('Order has no shift log');
    if (order.status !== 'IN_PROGRESS' && order.status !== 'STOPPAGE') {
      throw new Error('Capture only allowed on running orders');
    }

    if (order.combinedGroupId) {
      await this.writeCombinedProdRwd(order, data);
    } else {
      await ProductionService.saveRwd({
        machineCode: order.machineCode,
        shiftLogId: order.shiftLogId,
        coilNo: order.coilNo,
        widthMm: order.widthMm,
        thkMm: order.inputThkMm ?? order.ppcThkMm,
        outputThkMm: data.outputThkMm,
        weightMt: data.weightMt,
        rwTension1Kg: data.rwTension1Kg,
        rwTension2Kg: data.rwTension2Kg,
        rwTension3Kg: data.rwTension3Kg,
        surfaceFinish: data.surfaceFinish ?? order.surfaceFinish,
        remarks: data.remarks,
      });
    }

    if (data.complete !== false) {
      return this.endProduction(batchNumber, userId);
    }
    return this.getOrder(batchNumber, userId);
  }

  /**
   * Split combined weight across members lacking prod_rwd; copy tensions/thk/surface from capture.
   * `data.weightMt` is the combined actual total.
   */
  private static async writeCombinedProdRwd(
    primary: RwdOrderDetail,
    data: RwdCapturePayload,
  ): Promise<void> {
    if (!primary.combinedGroupId || !primary.shiftLogId) return;
    if (data.weightMt == null || !(data.weightMt > 0)) {
      throw new Error('weightMt is required for combined capture');
    }

    const members = await db
      .selectFrom('txn.rwd_order')
      .select([
        'batch_number',
        'coil_no',
        'machine_code',
        'shift_log_id',
        'width_mm',
        'input_thk_mm',
        'ppc_thk_mm',
        'ppc_weight_mt',
      ])
      .where('combined_group_id', '=', primary.combinedGroupId)
      .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .execute();
    if (!members.length) return;

    const snaps: Array<{ batchNumber: string; actualWeightMt: number | null }> = [];
    for (const m of members) {
      const prod = await this.latestProdRwd(m.coil_no);
      snaps.push({
        batchNumber: String(m.batch_number),
        actualWeightMt: prod?.weight_mt != null ? Number(prod.weight_mt) : null,
      });
    }

    const targets = members.map((m) => ({
      batchNumber: String(m.batch_number),
      targetMt: Number(m.ppc_weight_mt ?? 0),
    }));
    const allocation = allocateCombinedRemainderToBlanks(snaps, targets, data.weightMt);

    for (const m of members) {
      const bn = String(m.batch_number);
      const existing = snaps.find((s) => s.batchNumber === bn)?.actualWeightMt;
      if (existing != null) continue;
      const weightMt = allocation?.get(bn);
      if (weightMt == null) {
        // No blanks to fill (or primary-only re-save): write primary with form weight.
        if (bn !== primary.batchNumber) continue;
      }
      const shiftLogId = m.shift_log_id != null ? String(m.shift_log_id) : primary.shiftLogId;
      if (!shiftLogId) continue;
      await ProductionService.saveRwd({
        machineCode: m.machine_code,
        shiftLogId,
        coilNo: m.coil_no,
        widthMm: Number(m.width_mm ?? 0),
        thkMm: Number(m.input_thk_mm ?? m.ppc_thk_mm ?? 0),
        outputThkMm: data.outputThkMm,
        weightMt: weightMt ?? data.weightMt,
        rwTension1Kg: data.rwTension1Kg,
        rwTension2Kg: data.rwTension2Kg,
        rwTension3Kg: data.rwTension3Kg,
        surfaceFinish: data.surfaceFinish ?? primary.surfaceFinish,
        remarks: data.remarks,
      });
    }
  }

  static async addStoppage(
    batchNumber: string,
    categoryCode: string,
    breakdownCode: string | undefined,
    remarks: string | undefined,
    userId: number,
  ): Promise<RwdOrderDetail> {
    const orderId = await this.ensureOrder(batchNumber, userId);
    const orderRow = await db
      .selectFrom('txn.rwd_order')
      .select(['status', 'combined_group_id', 'shift_log_id', 'shift_code', 'prod_date', 'machine_code'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();

    assertCanAddStoppage(orderRow.status);

    let targets = [{ order_id: orderId, batch_number: batchNumber }];
    if (orderRow.combined_group_id) {
      const members = await this.loadCombinedGroupMembers(String(orderRow.combined_group_id), [
        'IN_PROGRESS',
        'STOPPAGE',
      ]);
      targets = members.map((m) => ({
        order_id: String(m.order_id),
        batch_number: String(m.batch_number),
      }));
    }

    const startAt = new Date();
    await db.transaction().execute(async (trx) => {
      for (const t of targets) {
        const open = await trx
          .selectFrom('txn.stoppage')
          .select('stoppage_id')
          .where('rwd_order_id', '=', t.order_id as any)
          .where('order_kind', '=', 'RWD')
          .where('end_at', 'is', null)
          .executeTakeFirst();
        if (open) continue;

        await trx
          .insertInto('txn.stoppage')
          .values({
            order_id: null,
            rwd_order_id: t.order_id as any,
            order_kind: 'RWD',
            category_code: categoryCode,
            breakdown_code: breakdownCode ?? null,
            remarks: remarks ?? null,
            operator_id: userId,
            start_at: startAt,
            shift_log_id: orderRow.shift_log_id,
            shift_code: orderRow.shift_code,
            prod_date: orderRow.prod_date,
            machine_code: orderRow.machine_code,
            tenant_id: getTenantId() || '00000000-0000-0000-0000-000000000001',
          } as any)
          .execute();

        await trx
          .updateTable('txn.rwd_order')
          .set({ status: 'STOPPAGE', updated_at: startAt })
          .where('order_id', '=', t.order_id as any)
          .execute();
      }
    });

    MachineStateEventService.recordEvent(orderRow.machine_code, 'STOPPAGE_STARTED', {
      orderId,
      batchNumber,
      operatorId: userId,
      shiftCode: orderRow.shift_code ?? undefined,
    }).catch(() => undefined);

    return this.getOrder(batchNumber, userId);
  }

  static async endStoppage(
    batchNumber: string,
    stoppageId: string,
    userId: number,
  ): Promise<RwdOrderDetail> {
    const orderId = await this.ensureOrder(batchNumber, userId);
    const stop = await db
      .selectFrom('txn.stoppage')
      .selectAll()
      .where('stoppage_id', '=', stoppageId as any)
      .where('rwd_order_id', '=', orderId as any)
      .executeTakeFirst();
    if (!stop) throw new Error('Stoppage not found');
    if (stop.end_at) return this.getOrder(batchNumber, userId);

    const endAt = new Date();

    const order = await db
      .selectFrom('txn.rwd_order')
      .select(['combined_group_id', 'machine_code', 'shift_code'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();

    let targets = [orderId];
    if (order.combined_group_id) {
      const members = await this.loadCombinedGroupMembers(String(order.combined_group_id), [
        'STOPPAGE',
      ]);
      targets = members.map((m) => String(m.order_id));
    }

    await db.transaction().execute(async (trx) => {
      for (const oid of targets) {
        const open = await trx
          .selectFrom('txn.stoppage')
          .select(['stoppage_id', 'start_at'])
          .where('rwd_order_id', '=', oid as any)
          .where('order_kind', '=', 'RWD')
          .where('end_at', 'is', null)
          .executeTakeFirst();
        if (!open) continue;
        const dur = resolveStoppageMinutes(open.start_at, endAt, null);
        await trx
          .updateTable('txn.stoppage')
          .set({ end_at: endAt, duration_min: dur })
          .where('stoppage_id', '=', open.stoppage_id)
          .execute();
        await trx
          .updateTable('txn.rwd_order')
          .set({ status: 'IN_PROGRESS', updated_at: endAt })
          .where('order_id', '=', oid as any)
          .where('status', '=', 'STOPPAGE')
          .execute();
      }
    });

    MachineStateEventService.recordEvent(order.machine_code, 'STOPPAGE_ENDED', {
      orderId,
      batchNumber,
      operatorId: userId,
      shiftCode: order.shift_code ?? undefined,
    }).catch(() => undefined);

    return this.getOrder(batchNumber, userId);
  }

  static async updateStoppage(
    batchNumber: string,
    stoppageId: string,
    categoryCode: string,
    breakdownCode: string | undefined,
    remarks: string | undefined,
    _userId: number,
  ): Promise<RwdOrderDetail> {
    const orderId = await this.ensureOrder(batchNumber, _userId);
    await db
      .updateTable('txn.stoppage')
      .set({
        category_code: categoryCode,
        breakdown_code: breakdownCode ?? null,
        remarks: remarks ?? null,
      })
      .where('stoppage_id', '=', stoppageId as any)
      .where('rwd_order_id', '=', orderId as any)
      .execute();
    return this.getOrder(batchNumber, _userId);
  }

  static async rejectOrder(
    batchNumber: string,
    rejectionReason: string,
    remarks: string,
    userId: number,
  ): Promise<RwdOrderDetail> {
    assertRejectPayload(rejectionReason, remarks);

    const orderId = await this.ensureOrder(batchNumber, userId);
    const current = await db
      .selectFrom('txn.rwd_order')
      .select(['status', 'combined_group_id', 'machine_code'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();

    if (current.status === 'REJECTED' && !current.combined_group_id) {
      return this.getOrder(batchNumber, userId);
    }

    let targets = [{ order_id: orderId, batch_number: batchNumber }];
    if (current.combined_group_id) {
      targets = (
        await db
          .selectFrom('txn.rwd_order')
          .select(['order_id', 'batch_number'])
          .where('combined_group_id', '=', current.combined_group_id)
          .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE', 'PENDING', 'PREPARING'])
          .execute()
      ).map((r) => ({
        order_id: String(r.order_id),
        batch_number: String(r.batch_number),
      }));
    }

    const heldAt = new Date();
    await db.transaction().execute(async (trx) => {
      for (const t of targets) {
        const open = await trx
          .selectFrom('txn.stoppage')
          .select(['stoppage_id', 'start_at'])
          .where('rwd_order_id', '=', t.order_id as any)
          .where('order_kind', '=', 'RWD')
          .where('end_at', 'is', null)
          .executeTakeFirst();
        if (open) {
          const dur = resolveStoppageMinutes(open.start_at, heldAt, null);
          await trx
            .updateTable('txn.stoppage')
            .set({ end_at: heldAt, duration_min: dur })
            .where('stoppage_id', '=', open.stoppage_id)
            .execute();
        }
        await trx
          .updateTable('txn.rwd_order')
          .set({
            status: 'REJECTED',
            hold_reason: rejectionReason.trim().slice(0, 100),
            hold_remarks: remarks.trim().slice(0, 500),
            held_at: heldAt,
            held_by: userId,
            updated_at: heldAt,
          })
          .where('order_id', '=', t.order_id as any)
          .execute();
      }
    });

    return this.getOrder(batchNumber, userId);
  }

  static async reinstateOrder(
    batchNumber: string,
    userId: number,
    target: 'PREPARING' | 'PENDING' = 'PREPARING',
  ): Promise<RwdOrderDetail> {
    const orderId = await this.ensureOrder(batchNumber, userId);
    const order = await db
      .selectFrom('txn.rwd_order')
      .select(['status', 'combined_group_id'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();
    if (order.status !== 'REJECTED') {
      throw new Error('Only held orders can be reinstated');
    }

    let targets = [orderId];
    if (order.combined_group_id) {
      const members = await db
        .selectFrom('txn.rwd_order')
        .select('order_id')
        .where('combined_group_id', '=', order.combined_group_id)
        .where('status', '=', 'REJECTED')
        .execute();
      targets = members.map((m) => String(m.order_id));
    }

    await db
      .updateTable('txn.rwd_order')
      .set({
        status: target,
        hold_reason: null,
        hold_remarks: null,
        held_at: null,
        held_by: null,
        updated_at: new Date(),
      })
      .where('order_id', 'in', targets as any)
      .execute();

    return this.getOrder(batchNumber, userId);
  }

  /** Manual rewinding batch → ppc_batch (unallocated) + ensure rwd_order. */
  static async createManualBatch(
    row: {
      batch_number: string;
      plan_date: string;
      shift_code: string;
      machine_code: string;
      coil_no: string;
      slit_id?: string;
      customer_name: string;
      grade_code: string;
      width_mm: number;
      input_thk_mm?: number;
      ppc_thk_mm: number;
      ppc_weight_mt: number;
      roll_finish?: string;
    },
    userId: number,
  ): Promise<{ batchNumber: string; orderId: string }> {
    const machine = assertRewindingMachine(row.machine_code);
    const dup = await db
      .selectFrom('planning.ppc_batch')
      .select('batch_id')
      .where('batch_number', '=', row.batch_number)
      .executeTakeFirst();
    if (dup) throw new Error(`Duplicate batch number: ${row.batch_number}`);

    const gradeCode = row.grade_code.trim();
    const existingGrade = await db
      .selectFrom('master.grade')
      .select('grade_code')
      .where('grade_code', '=', gradeCode)
      .executeTakeFirst();
    if (!existingGrade) {
      await db
        .insertInto('master.grade')
        .values({
          grade_code: gradeCode,
          description: `Manual RWD grade ${gradeCode}`,
          grade_family: 'PPC',
        })
        .onConflict((oc) => oc.column('grade_code').doNothing())
        .execute();
    }

    // REWINDING / RWD sub_process FK — prefer REWINDING for 2HI, RWD for RWD line
    const subProcess = machine === 'RWD' ? 'RWD' : 'REWINDING';

    const importBatch = await db
      .insertInto('planning.import_batch')
      .values({
        source: 'MANUAL',
        file_name: `manual-rwd-${row.batch_number}`,
        row_count: 1,
        status: 'LOADED',
        imported_by: userId,
      } as any)
      .returning('import_batch_id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('planning.ppc_batch')
      .values({
        batch_number: row.batch_number,
        plan_date: row.plan_date,
        shift_code: row.shift_code,
        machine_code: machine,
        sub_process: subProcess,
        coil_no: row.coil_no,
        slit_id: row.slit_id ?? null,
        customer_name: row.customer_name,
        grade_code: row.grade_code,
        width_mm: row.width_mm,
        input_thk_mm: row.input_thk_mm ?? row.ppc_thk_mm,
        ppc_thk_mm: row.ppc_thk_mm,
        ppc_weight_mt: row.ppc_weight_mt,
        roll_finish: row.roll_finish ?? null,
        from_work_center: 'R',
        machine_allocated: true,
        import_batch_id: importBatch.import_batch_id,
      } as any)
      .execute();

    const orderId = await this.ensureOrder(row.batch_number, userId);
    return { batchNumber: row.batch_number, orderId };
  }

  static rewindingPool(): readonly RewindingMachineCode[] {
    return REWINDING_MACHINES;
  }

  static parseMachine(raw: string): RewindingMachineCode | null {
    return parseRewindingMachineCode(raw);
  }
}
