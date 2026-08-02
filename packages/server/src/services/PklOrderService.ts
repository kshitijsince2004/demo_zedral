/**
 * PKL line order lifecycle over txn.pkl_order.
 * Mirrors HrsOrderService, keyed by mother coil_no — single line, no order-lines.
 */
import { formatPlantDate, postgresDateOnly } from '@m1/shared-validation';
import { db } from '../db';
import { getTenantId } from '../context';
import { ShiftDetectionService } from './ShiftDetectionService';
import { MachineStateEventService } from './MachineStateEventService';
import { resolveStoppageMinutes } from '../validation/manufacturingValidation';
import { netProdDurationMin } from '../utils/orderLifecycleHelpers';
import { parseCoilIdentity } from '../utils/rwdFieldMappers';

export type PklOrderStatus =
  | 'PENDING'
  | 'PREPARING'
  | 'IN_PROGRESS'
  | 'STOPPAGE'
  | 'COMPLETED'
  | 'REJECTED';

export type PklQueueCard = {
  coilNo: string;
  displayCoilNo?: string;
  gradeCode: string;
  customerName: string;
  widthMm: number;
  thicknessMm: number;
  weightMt: number;
  status: PklOrderStatus;
  machineCode: 'PKL';
  motherCoilNo?: string;
  slitId?: string;
  journeyId?: string;
  stepNo?: number;
};

export type PklOrderDetail = {
  orderId: string;
  coilNo: string;
  customerName: string;
  gradeCode: string;
  widthMm: number;
  thicknessMm: number;
  weightMt: number;
  machineCode: 'PKL';
  status: PklOrderStatus;
  prodStartAt?: string;
  prodEndAt?: string;
  prodDurationMin?: number;
  shiftLogId?: string;
  shiftCode?: string;
  holdReason?: string;
  holdRemarks?: string;
  activeStoppageId?: string;
  stoppages: Array<{
    stoppageId: string;
    categoryCode: string;
    breakdownCode?: string;
    startAt: string;
    endAt?: string;
    durationMin?: number;
    remarks?: string;
  }>;
  motherCoilNo?: string;
  slitId?: string;
};

const PKL_PROCESS_CODE = 'PKL';

export class PklOrderService {
  static async getProcessId(): Promise<number> {
    const row = await db
      .selectFrom('master.process')
      .select('process_id')
      .where('code', '=', PKL_PROCESS_CODE)
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

  /** Ensure pkl_order row exists for a mother coil. */
  static async ensureOrder(coilNo: string, userId: number): Promise<string> {
    const existing = await db
      .selectFrom('txn.pkl_order')
      .select('order_id')
      .where('coil_no', '=', coilNo)
      .executeTakeFirst();
    if (existing) {
      return String(existing.order_id);
    }

    const coil = await db
      .selectFrom('coil.coil as c')
      .leftJoin('master.customer as cu', 'cu.customer_id', 'c.customer_id')
      .select([
        'c.coil_no', 'c.grade_code', 'c.nominal_width_mm', 'c.coil_width_mm',
        'c.coil_thk_mm', 'c.weight_mt', 'cu.customer_name', 'c.parent_coil_no',
      ])
      .where('c.coil_no', '=', coilNo)
      .executeTakeFirst();
    if (!coil) throw new Error(`Coil not found: ${coilNo}`);

    const firstBatch = await db
      .selectFrom('planning.ppc_batch')
      .select(['customer_name', 'grade_code', 'width_mm', 'input_thk_mm', 'ppc_thk_mm', 'ppc_weight_mt'])
      .where('coil_no', '=', coilNo)
      .where((eb) =>
        eb.or([
          eb('machine_code', '=', 'PKL'),
          eb('sub_process', '=', 'PKL'),
          eb('from_work_center', 'in', ['P', 'PKL']),
        ]),
      )
      .orderBy('slit_id', 'asc')
      .orderBy('batch_number', 'asc')
      .executeTakeFirst();

    const detected = await ShiftDetectionService.getCurrentShift({
      userId,
      machineCode: 'PKL',
    });
    const prodDate = postgresDateOnly(detected.prodDate);
    const activeShift = detected.shiftCode.toUpperCase();
    const shiftLogId = await this.ensureActiveShiftLog(userId, prodDate, activeShift);

    const activeStep = await db
      .selectFrom('planning.order_journey as oj')
      .innerJoin('planning.order_journey_step as ojs', (join) =>
        join.onRef('ojs.journey_id', '=', 'oj.journey_id').onRef('ojs.step_no', '=', 'oj.current_step_no'),
      )
      .select('ojs.status')
      .where('oj.coil_no', '=', coilNo)
      .where('ojs.process_code', '=', 'PKL')
      .where('ojs.status', '=', 'ACTIVE')
      .executeTakeFirst();

    const identity = parseCoilIdentity(coilNo);
    const motherCoilNo = coil.parent_coil_no ?? undefined;
    const slitId = identity.slitId ?? undefined;

    const order = await db
      .insertInto('txn.pkl_order')
      .values({
        coil_no: coilNo,
        mother_coil_no: motherCoilNo ?? null,
        slit_id: slitId ?? null,
        customer_name: firstBatch?.customer_name ?? coil.customer_name ?? 'Unknown',
        grade_code: firstBatch?.grade_code ?? coil.grade_code ?? 'NA',
        nominal_width_mm: firstBatch?.width_mm ?? coil.nominal_width_mm ?? coil.coil_width_mm ?? 0,
        nominal_thk_mm: firstBatch?.input_thk_mm ?? firstBatch?.ppc_thk_mm ?? coil.coil_thk_mm ?? 0,
        mother_coil_weight_mt: firstBatch?.ppc_weight_mt ?? coil.weight_mt ?? 0,
        machine_code: 'PKL',
        status: activeStep ? 'PREPARING' : 'PENDING',
        logged_in_user_id: userId,
        production_day: prodDate,
        shift_log_id: shiftLogId,
        shift_code: activeShift,
        prod_date: prodDate,
      } as any)
      .returning('order_id')
      .executeTakeFirstOrThrow();

    return String(order.order_id);
  }

  static async getOrder(coilNo: string, userId: number): Promise<PklOrderDetail> {
    await this.ensureOrder(coilNo, userId);
    const order = await db
      .selectFrom('txn.pkl_order')
      .selectAll()
      .where('coil_no', '=', coilNo)
      .executeTakeFirstOrThrow();

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
      .where('pkl_order_id', '=', order.order_id)
      .where('order_kind', '=', 'PKL')
      .orderBy('start_at', 'desc')
      .execute();

    const active = stoppages.find((s) => !s.end_at);
    let status = order.status as PklOrderStatus;
    if (status === 'STOPPAGE' && !active) {
      status = order.prod_start_at ? 'IN_PROGRESS' : 'PENDING';
      await db
        .updateTable('txn.pkl_order')
        .set({ status, updated_at: new Date() })
        .where('order_id', '=', order.order_id)
        .where('status', '=', 'STOPPAGE')
        .execute();
    }

    return {
      orderId: String(order.order_id),
      coilNo: order.coil_no,
      customerName: order.customer_name,
      gradeCode: order.grade_code,
      widthMm: Number(order.nominal_width_mm),
      thicknessMm: Number(order.nominal_thk_mm),
      weightMt: Number(order.mother_coil_weight_mt),
      machineCode: 'PKL',
      status,
      prodStartAt: order.prod_start_at ? new Date(order.prod_start_at).toISOString() : undefined,
      prodEndAt: order.prod_end_at ? new Date(order.prod_end_at).toISOString() : undefined,
      prodDurationMin: order.prod_duration_min ?? undefined,
      shiftLogId: order.shift_log_id != null ? String(order.shift_log_id) : undefined,
      shiftCode: order.shift_code ?? undefined,
      holdReason: order.hold_reason ?? undefined,
      holdRemarks: order.hold_remarks ?? undefined,
      activeStoppageId: active ? String(active.stoppage_id) : undefined,
      stoppages: stoppages.map((s) => ({
        stoppageId: String(s.stoppage_id),
        categoryCode: s.category_code,
        breakdownCode: s.breakdown_code ?? undefined,
        startAt: new Date(s.start_at).toISOString(),
        endAt: s.end_at ? new Date(s.end_at).toISOString() : undefined,
        durationMin: s.duration_min ?? undefined,
        remarks: s.remarks ?? undefined,
      })),
      motherCoilNo: order.mother_coil_no ?? undefined,
      slitId: order.slit_id ?? undefined,
    };
  }

  static async getQueue(userId: number): Promise<{ queue: PklQueueCard[] }> {
    const rows = await db
      .selectFrom('planning.order_journey as oj')
      .innerJoin('planning.order_journey_step as ojs', (join) =>
        join.onRef('ojs.journey_id', '=', 'oj.journey_id').onRef('ojs.step_no', '=', 'oj.current_step_no'),
      )
      .select(['oj.journey_id', 'oj.coil_no', 'ojs.step_no'])
      .where('oj.status', 'in', ['ACTIVE', 'HOLD'])
      .where('ojs.process_code', '=', 'PKL')
      .where('ojs.status', 'in', ['PENDING', 'ACTIVE', 'HOLD'])
      .orderBy('ojs.started_at', 'asc')
      .orderBy('oj.journey_id', 'asc')
      .execute();

    const queue: PklQueueCard[] = [];
    const seenCoils = new Set<string>();

    for (const row of rows) {
      seenCoils.add(row.coil_no);
      await this.ensureOrder(row.coil_no, userId);
      const order = await db
        .selectFrom('txn.pkl_order')
        .selectAll()
        .where('coil_no', '=', row.coil_no)
        .executeTakeFirstOrThrow();
      queue.push({
        coilNo: order.coil_no,
        gradeCode: order.grade_code,
        customerName: order.customer_name,
        widthMm: Number(order.nominal_width_mm),
        thicknessMm: Number(order.nominal_thk_mm),
        weightMt: Number(order.mother_coil_weight_mt),
        status: order.status as PklOrderStatus,
        machineCode: 'PKL',
        motherCoilNo: order.mother_coil_no ?? undefined,
        slitId: order.slit_id ?? undefined,
        journeyId: String(row.journey_id),
        stepNo: row.step_no,
      });
    }

    const extraOrders = await db
      .selectFrom('txn.pkl_order')
      .selectAll()
      .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE', 'REJECTED'])
      .execute();
    for (const order of extraOrders) {
      if (seenCoils.has(order.coil_no)) continue;
      queue.push({
        coilNo: order.coil_no,
        gradeCode: order.grade_code,
        customerName: order.customer_name,
        widthMm: Number(order.nominal_width_mm),
        thicknessMm: Number(order.nominal_thk_mm),
        weightMt: Number(order.mother_coil_weight_mt),
        status: order.status as PklOrderStatus,
        machineCode: 'PKL',
        motherCoilNo: order.mother_coil_no ?? undefined,
        slitId: order.slit_id ?? undefined,
      });
    }

    return { queue };
  }

  private static async totalStoppageMinutes(orderId: string | number, asOf?: Date): Promise<number> {
    const rows = await db
      .selectFrom('txn.stoppage')
      .select(['start_at', 'end_at', 'duration_min'])
      .where('pkl_order_id', '=', orderId as any)
      .where('order_kind', '=', 'PKL')
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
      .where('pkl_order_id', '=', orderId as any)
      .where('order_kind', '=', 'PKL')
      .where('end_at', 'is', null)
      .executeTakeFirst();
    if (open) throw new Error('Close open stoppage before continuing');
  }

  private static async findActiveMachineOrder() {
    const row = await db
      .selectFrom('txn.pkl_order')
      .select(['coil_no', 'order_id', 'status'])
      .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .executeTakeFirst();
    return row ? { coilNo: row.coil_no, orderId: row.order_id, status: row.status } : null;
  }

  static async startProduction(coilNo: string, userId: number): Promise<PklOrderDetail> {
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed('PKL', userId);

    const active = await this.findActiveMachineOrder();
    if (active && active.coilNo !== coilNo) {
      throw new Error(`ACTIVE_ORDER_CONFLICT:${active.coilNo}`);
    }

    const orderId = await this.ensureOrder(coilNo, userId);
    const orderRow = await db
      .selectFrom('txn.pkl_order')
      .select(['order_id', 'status', 'coil_no', 'prod_start_at', 'shift_code'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();

    if (orderRow.status === 'IN_PROGRESS') return this.getOrder(coilNo, userId);

    if (orderRow.status === 'STOPPAGE') {
      await this.assertNoOpenStoppage(orderId);
      await db
        .updateTable('txn.pkl_order')
        .set({ status: 'IN_PROGRESS', updated_at: new Date() })
        .where('order_id', '=', orderId as any)
        .where('status', '=', 'STOPPAGE')
        .execute();
      MachineStateEventService.recordEvent('PKL', 'RUNNING_STARTED', {
        orderId,
        operatorId: userId,
        shiftCode: orderRow.shift_code ?? undefined,
      }).catch(() => undefined);
      return this.getOrder(coilNo, userId);
    }

    if (orderRow.status !== 'PENDING' && orderRow.status !== 'PREPARING') {
      throw new Error('Only pending or preparing orders can be started');
    }

    await db
      .updateTable('txn.pkl_order')
      .set({
        status: 'IN_PROGRESS',
        prod_start_at: orderRow.prod_start_at ?? new Date(),
        updated_at: new Date(),
      })
      .where('order_id', '=', orderId as any)
      .execute();

    await db
      .updateTable('coil.coil')
      .set({ status: 'IN_PROCESS' })
      .where('coil_no', '=', orderRow.coil_no)
      .execute();

    MachineStateEventService.recordEvent('PKL', 'RUNNING_STARTED', {
      orderId,
      operatorId: userId,
      shiftCode: orderRow.shift_code ?? undefined,
    }).catch(() => undefined);

    return this.getOrder(coilNo, userId);
  }

  static async endProduction(coilNo: string, userId: number): Promise<PklOrderDetail> {
    const order = await db
      .selectFrom('txn.pkl_order')
      .selectAll()
      .where('coil_no', '=', coilNo)
      .executeTakeFirstOrThrow();
    if (order.status !== 'IN_PROGRESS' && order.status !== 'STOPPAGE') {
      throw new Error('Only running orders can be completed');
    }

    await this.assertNoOpenStoppage(order.order_id);

    const endAt = new Date();
    const stopMin = await this.totalStoppageMinutes(order.order_id, endAt);
    const duration = order.prod_start_at
      ? netProdDurationMin(new Date(order.prod_start_at), endAt, stopMin)
      : 0;

    await db
      .updateTable('txn.pkl_order')
      .set({
        status: 'COMPLETED',
        prod_end_at: endAt,
        prod_duration_min: duration,
        updated_at: endAt,
      })
      .where('order_id', '=', order.order_id)
      .execute();

    await db
      .updateTable('coil.coil')
      .set({ status: 'DONE' })
      .where('coil_no', '=', order.coil_no)
      .execute();

    MachineStateEventService.recordEvent('PKL', 'RUNNING_ENDED', {
      orderId: order.order_id,
      operatorId: userId,
      shiftCode: order.shift_code ?? undefined,
    }).catch(() => undefined);

    return this.getOrder(coilNo, userId);
  }

  static async addStoppage(
    coilNo: string,
    categoryCode: string,
    breakdownCode: string | undefined,
    remarks: string | undefined,
    userId: number,
  ): Promise<PklOrderDetail> {
    const orderId = await this.ensureOrder(coilNo, userId);
    const orderRow = await db
      .selectFrom('txn.pkl_order')
      .select(['status', 'shift_log_id', 'shift_code', 'prod_date'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();

    if (orderRow.status !== 'IN_PROGRESS' && orderRow.status !== 'STOPPAGE') {
      throw new Error('Stoppage can only be recorded while production is running');
    }

    const startAt = new Date();
    await db.transaction().execute(async (trx) => {
      const open = await trx
        .selectFrom('txn.stoppage')
        .select('stoppage_id')
        .where('pkl_order_id', '=', orderId as any)
        .where('order_kind', '=', 'PKL')
        .where('end_at', 'is', null)
        .executeTakeFirst();
      if (open) return;

      await trx
        .insertInto('txn.stoppage')
        .values({
          order_id: null,
          pkl_order_id: orderId as any,
          order_kind: 'PKL',
          category_code: categoryCode,
          breakdown_code: breakdownCode ?? null,
          remarks: remarks ?? null,
          operator_id: userId,
          start_at: startAt,
          shift_log_id: orderRow.shift_log_id,
          shift_code: orderRow.shift_code,
          prod_date: orderRow.prod_date,
          machine_code: 'PKL',
          tenant_id: getTenantId() || '00000000-0000-0000-0000-000000000001',
        } as any)
        .execute();

      await trx
        .updateTable('txn.pkl_order')
        .set({ status: 'STOPPAGE', updated_at: startAt })
        .where('order_id', '=', orderId as any)
        .execute();
    });

    MachineStateEventService.recordEvent('PKL', 'STOPPAGE_STARTED', {
      orderId,
      operatorId: userId,
      shiftCode: orderRow.shift_code ?? undefined,
    }).catch(() => undefined);

    return this.getOrder(coilNo, userId);
  }

  static async endStoppage(
    coilNo: string,
    stoppageId: string,
    userId: number,
  ): Promise<PklOrderDetail> {
    const orderId = await this.ensureOrder(coilNo, userId);
    const stop = await db
      .selectFrom('txn.stoppage')
      .selectAll()
      .where('stoppage_id', '=', stoppageId as any)
      .where('pkl_order_id', '=', orderId as any)
      .executeTakeFirst();
    if (!stop) throw new Error('Stoppage not found');
    if (stop.end_at) return this.getOrder(coilNo, userId);

    const endAt = new Date();
    const order = await db
      .selectFrom('txn.pkl_order')
      .select(['shift_code'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();

    const dur = resolveStoppageMinutes(stop.start_at, endAt, null);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('txn.stoppage')
        .set({ end_at: endAt, duration_min: dur })
        .where('stoppage_id', '=', stop.stoppage_id)
        .execute();
      await trx
        .updateTable('txn.pkl_order')
        .set({ status: 'IN_PROGRESS', updated_at: endAt })
        .where('order_id', '=', orderId as any)
        .where('status', '=', 'STOPPAGE')
        .execute();
    });

    MachineStateEventService.recordEvent('PKL', 'STOPPAGE_ENDED', {
      orderId,
      operatorId: userId,
      shiftCode: order.shift_code ?? undefined,
    }).catch(() => undefined);

    return this.getOrder(coilNo, userId);
  }

  static async updateStoppage(
    coilNo: string,
    stoppageId: string,
    categoryCode: string,
    breakdownCode: string | undefined,
    remarks: string | undefined,
    userId: number,
  ): Promise<PklOrderDetail> {
    const orderId = await this.ensureOrder(coilNo, userId);
    await db
      .updateTable('txn.stoppage')
      .set({
        category_code: categoryCode,
        breakdown_code: breakdownCode ?? null,
        remarks: remarks ?? null,
      })
      .where('stoppage_id', '=', stoppageId as any)
      .where('pkl_order_id', '=', orderId as any)
      .execute();
    return this.getOrder(coilNo, userId);
  }

  static async rejectOrder(
    coilNo: string,
    rejectionReason: string,
    remarks: string,
    userId: number,
  ): Promise<PklOrderDetail> {
    if (!rejectionReason?.trim()) throw new Error('Hold reason is required');
    if (!remarks?.trim()) throw new Error('Hold remarks are required');

    const orderId = await this.ensureOrder(coilNo, userId);
    const current = await db
      .selectFrom('txn.pkl_order')
      .select(['status'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();

    if (current.status === 'REJECTED') return this.getOrder(coilNo, userId);

    const heldAt = new Date();
    await db.transaction().execute(async (trx) => {
      const open = await trx
        .selectFrom('txn.stoppage')
        .select(['stoppage_id', 'start_at'])
        .where('pkl_order_id', '=', orderId as any)
        .where('order_kind', '=', 'PKL')
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
        .updateTable('txn.pkl_order')
        .set({
          status: 'REJECTED',
          hold_reason: rejectionReason.trim().slice(0, 100),
          hold_remarks: remarks.trim().slice(0, 500),
          held_at: heldAt,
          held_by: userId,
          updated_at: heldAt,
        })
        .where('order_id', '=', orderId as any)
        .execute();
    });

    return this.getOrder(coilNo, userId);
  }

  static async reinstateOrder(
    coilNo: string,
    userId: number,
    target: 'PREPARING' | 'PENDING' = 'PREPARING',
  ): Promise<PklOrderDetail> {
    const orderId = await this.ensureOrder(coilNo, userId);
    const order = await db
      .selectFrom('txn.pkl_order')
      .select(['status'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();
    if (order.status !== 'REJECTED') {
      throw new Error('Only held orders can be reinstated');
    }

    await db
      .updateTable('txn.pkl_order')
      .set({
        status: target,
        hold_reason: null,
        hold_remarks: null,
        held_at: null,
        held_by: null,
        updated_at: new Date(),
      })
      .where('order_id', '=', orderId as any)
      .execute();

    return this.getOrder(coilNo, userId);
  }
}
