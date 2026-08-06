/**
 * PKL line order lifecycle over txn.pkl_order.
 * Mirrors HrsOrderService; supports per-batch PKL orders (multi-batch mother coils).
 */
import { formatPlantDate, postgresDateOnly, PLANT_TIME_ZONE } from '@m1/shared-validation';
import { sql } from 'kysely';
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
  routeRaw?: string;
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
  private static readonly ORDER_STATUS_PRIORITY: Record<PklOrderStatus, number> = {
    IN_PROGRESS: 6,
    STOPPAGE: 5,
    PREPARING: 4,
    PENDING: 3,
    REJECTED: 2,
    COMPLETED: 1,
  };

  private static choosePreferredOrder<T extends { status: string; order_id: unknown }>(rows: T[]): T | undefined {
    return rows
      .slice()
      .sort((a, b) => {
        const pa = this.ORDER_STATUS_PRIORITY[a.status as PklOrderStatus] ?? 0;
        const pb = this.ORDER_STATUS_PRIORITY[b.status as PklOrderStatus] ?? 0;
        if (pa !== pb) return pb - pa;
        return Number(b.order_id) - Number(a.order_id);
      })[0];
  }

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

  /** Ensure pkl_order row exists for a PKL plan batch. */
  static async ensureOrderForBatch(
    batchNumber: string,
    userId: number,
    coilNoOverride?: string,
  ): Promise<string> {
    const batch = await db
      .selectFrom('planning.ppc_batch')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch) throw new Error(`PKL batch not found: ${batchNumber}`);

    const existing = await db
      .selectFrom('txn.pkl_order')
      .select(['order_id', 'coil_no'])
      .where('batch_id', '=', batch.batch_id)
      .executeTakeFirst();
    if (existing) {
      if (coilNoOverride && existing.coil_no !== coilNoOverride) {
        const id = parseCoilIdentity(coilNoOverride);
        await db
          .updateTable('txn.pkl_order')
          .set({
            coil_no: coilNoOverride,
            mother_coil_no: id.coilNo,
            slit_id: batch.slit_id ?? id.slitId,
            updated_at: new Date(),
          } as any)
          .where('order_id', '=', existing.order_id)
          .execute();
      }
      return String(existing.order_id);
    }

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
      .where('oj.coil_no', '=', batch.coil_no)
      .where('ojs.process_code', '=', 'PKL')
      .where('ojs.status', '=', 'ACTIVE')
      .executeTakeFirst();

    const coilNo = coilNoOverride ?? batch.coil_no;
    const identity = parseCoilIdentity(coilNo);
    const motherCoilNo = identity.coilNo;
    const slitId = batch.slit_id ?? identity.slitId ?? null;

    const order = await db
      .insertInto('txn.pkl_order')
      .values({
        batch_id: batch.batch_id,
        batch_number: batch.batch_number,
        coil_no: coilNo,
        mother_coil_no: motherCoilNo ?? null,
        slit_id: slitId,
        customer_name: batch.customer_name,
        grade_code: batch.grade_code,
        nominal_width_mm: batch.width_mm,
        nominal_thk_mm: batch.input_thk_mm ?? batch.ppc_thk_mm,
        mother_coil_weight_mt: batch.ppc_weight_mt,
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

  /** Legacy ensure for coil routes; picks/creates one best-fit batch order. */
  static async ensureOrder(coilNo: string, userId: number): Promise<string> {
    const identity = parseCoilIdentity(coilNo);
    const existingOrders = await db
      .selectFrom('txn.pkl_order')
      .select(['order_id', 'status', 'coil_no'])
      .where((eb) => {
        const conds = [eb('coil_no', '=', coilNo)];
        if (identity.slitId && identity.coilNo !== coilNo) {
          conds.push(eb.and([
            eb('coil_no', '=', identity.coilNo),
            eb('slit_id', '=', identity.slitId),
          ]));
          conds.push(eb.and([
            eb('mother_coil_no', '=', identity.coilNo),
            eb('slit_id', '=', identity.slitId),
          ]));
        }
        return eb.or(conds);
      })
      .execute();
    const preferred = this.choosePreferredOrder(existingOrders);
    if (preferred) {
      if (preferred.coil_no !== coilNo) {
        await db
          .updateTable('txn.pkl_order')
          .set({
            coil_no: coilNo,
            mother_coil_no: identity.coilNo,
            slit_id: identity.slitId,
            updated_at: new Date(),
          } as any)
          .where('order_id', '=', preferred.order_id)
          .execute();
      }
      return String(preferred.order_id);
    }

    const batchNumber = await this.findPklBatchNumber(coilNo);
    if (!batchNumber) throw new Error(`No PKL batch found for coil: ${coilNo}`);
    return this.ensureOrderForBatch(batchNumber, userId, coilNo);
  }

  private static async findPklBatchNumber(coilNo: string): Promise<string | undefined> {
    const direct = await db
      .selectFrom('planning.ppc_batch')
      .select('batch_number')
      .where('coil_no', '=', coilNo)
      .where((eb) => eb.or([
        eb('machine_code', '=', 'PKL'),
        eb('sub_process', '=', 'PKL'),
        eb('from_work_center', 'in', ['P', 'PKL']),
      ]))
      .orderBy('slit_id', 'asc')
      .orderBy('batch_number', 'asc')
      .executeTakeFirst();
    if (direct?.batch_number) return String(direct.batch_number);

    const identity = parseCoilIdentity(coilNo);
    if (!identity.slitId || identity.coilNo === coilNo) return undefined;

    const bySlit = await db
      .selectFrom('planning.ppc_batch')
      .select('batch_number')
      .where('coil_no', '=', identity.coilNo)
      .where(sql<boolean>`upper(trim(slit_id)) = ${identity.slitId.toUpperCase()}`)
      .where((eb) => eb.or([
        eb('machine_code', '=', 'PKL'),
        eb('sub_process', '=', 'PKL'),
        eb('from_work_center', 'in', ['P', 'PKL']),
      ]))
      .orderBy('batch_number', 'asc')
      .executeTakeFirst();
    if (bySlit?.batch_number) return String(bySlit.batch_number);

    const motherRows = await db
      .selectFrom('planning.ppc_batch')
      .select('batch_number')
      .where('coil_no', '=', identity.coilNo)
      .where((eb) => eb.or([
        eb('machine_code', '=', 'PKL'),
        eb('sub_process', '=', 'PKL'),
        eb('from_work_center', 'in', ['P', 'PKL']),
      ]))
      .orderBy('slit_id', 'asc')
      .orderBy('batch_number', 'asc')
      .execute();
    return motherRows.length === 1 && motherRows[0]?.batch_number
      ? String(motherRows[0].batch_number)
      : undefined;
  }

  static async getOrder(coilNo: string, userId: number): Promise<PklOrderDetail> {
    const ensuredOrderId = await this.ensureOrder(coilNo, userId);
    const order = await db
      .selectFrom('txn.pkl_order')
      .selectAll()
      .where('order_id', '=', ensuredOrderId as any)
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
      .select(['oj.journey_id', 'oj.coil_no', 'ojs.step_no', 'ojs.queue_batch_id'])
      .where('oj.status', 'in', ['ACTIVE', 'HOLD'])
      .where('ojs.process_code', '=', 'PKL')
      .where('ojs.status', 'in', ['PENDING', 'ACTIVE', 'HOLD'])
      .orderBy('ojs.started_at', 'asc')
      .orderBy('oj.journey_id', 'asc')
      .execute();

    const queue: PklQueueCard[] = [];
    const seenOrders = new Set<string>();

    const resolveRoute = async (coilNo: string): Promise<string | undefined> => {
      const batch = await db
        .selectFrom('planning.ppc_batch')
        .select('process_route_raw')
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
      return batch?.process_route_raw ? String(batch.process_route_raw) : undefined;
    };

    const pushOrder = async (
      order: {
        coil_no: string;
        grade_code: string | null;
        customer_name: string | null;
        nominal_width_mm: number | string | null;
        nominal_thk_mm: number | string | null;
        mother_coil_weight_mt: number | string | null;
        status: string;
        mother_coil_no?: string | null;
        slit_id?: string | null;
      },
      extra?: { journeyId?: string; stepNo?: number },
    ) => {
      const oid = String((order as any).order_id ?? `${order.coil_no}|${order.slit_id ?? ''}|${order.status}`);
      if (seenOrders.has(oid)) return;
      seenOrders.add(oid);
      queue.push({
        coilNo: order.coil_no,
        gradeCode: order.grade_code ?? '',
        customerName: order.customer_name ?? '',
        widthMm: Number(order.nominal_width_mm),
        thicknessMm: Number(order.nominal_thk_mm),
        weightMt: Number(order.mother_coil_weight_mt),
        status: order.status as PklOrderStatus,
        machineCode: 'PKL',
        motherCoilNo: order.mother_coil_no ?? undefined,
        slitId: order.slit_id ?? undefined,
        journeyId: extra?.journeyId,
        stepNo: extra?.stepNo,
        routeRaw: await resolveRoute(order.coil_no),
      });
    };

    for (const row of rows) {
      try {
        if (row.queue_batch_id != null) {
          const matched = await db
            .selectFrom('planning.ppc_batch')
            .select(['batch_number'])
            .where('batch_id', '=', row.queue_batch_id as any)
            .executeTakeFirst();
          const orderId = matched?.batch_number
            ? await this.ensureOrderForBatch(String(matched.batch_number), userId, row.coil_no)
            : await this.ensureOrder(row.coil_no, userId);
          const order = await db
            .selectFrom('txn.pkl_order')
            .selectAll()
            .where('order_id', '=', orderId as any)
            .executeTakeFirstOrThrow();
          await pushOrder(order, { journeyId: String(row.journey_id), stepNo: row.step_no });
        } else {
          await this.ensureOrder(row.coil_no, userId);
          const order = await db
            .selectFrom('txn.pkl_order')
            .selectAll()
            .where('coil_no', '=', row.coil_no)
            .orderBy('order_id', 'desc')
            .executeTakeFirstOrThrow();
          await pushOrder(order, { journeyId: String(row.journey_id), stepNo: row.step_no });
        }
      } catch (err) {
        console.warn(`[pkl.queue] skip ${row.coil_no}:`, err instanceof Error ? err.message : err);
      }
    }

    const extraOrders = await db
      .selectFrom('txn.pkl_order')
      .selectAll()
      .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE', 'REJECTED'])
      .execute();
    for (const order of extraOrders) {
      await pushOrder(order);
    }

    // Completed for current plant day — status pill parity with Rolling.
    const shift = await ShiftDetectionService.getCurrentShift({ userId, machineCode: 'PKL' });
    const prodDate = postgresDateOnly(shift.prodDate);
    const completed = await db
      .selectFrom('txn.pkl_order')
      .selectAll()
      .where('status', '=', 'COMPLETED')
      .where(sql<boolean>`(
        prod_date = ${prodDate}::date
        OR production_day = ${prodDate}::date
        OR (prod_end_at AT TIME ZONE ${PLANT_TIME_ZONE})::date = ${prodDate}::date
      )`)
      .orderBy('prod_end_at', 'desc')
      .execute();
    for (const order of completed) {
      await pushOrder(order);
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
    const orderId = await this.ensureOrder(coilNo, userId);
    const order = await db
      .selectFrom('txn.pkl_order')
      .selectAll()
      .where('order_id', '=', orderId as any)
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
    const shift = await ShiftDetectionService.getCurrentShift({ userId, machineCode: 'PKL' });
    const prodDate = postgresDateOnly(shift.prodDate);

    await db
      .updateTable('txn.pkl_order')
      .set({
        status: 'COMPLETED',
        prod_end_at: endAt,
        prod_duration_min: duration,
        prod_date: prodDate as never,
        production_day: prodDate as never,
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
    const catMatch = categoryCode.trim().match(/^(?:PKL-)?(\d{1,2})$/i);
    const normalizedCategory = catMatch ? catMatch[1].padStart(2, '0') : categoryCode.trim();
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
          category_code: normalizedCategory,
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

  private static parseMachineEventMeta(meta: unknown): Record<string, unknown> {
    if (!meta) return {};
    if (typeof meta === 'string') {
      try {
        const parsed = JSON.parse(meta);
        return typeof parsed === 'object' && parsed ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    }
    return typeof meta === 'object' ? meta as Record<string, unknown> : {};
  }

  private static async resolveStoppageCategoryLabel(categoryCode?: string | null) {
    if (!categoryCode) return undefined;
    const candidates = [categoryCode];
    if (/^\d{1,2}$/.test(categoryCode)) {
      const padded = categoryCode.padStart(2, '0');
      candidates.push(padded, `PKL-${padded}`);
    }
    const pklRow = await db.selectFrom('master.stoppage_code')
      .select(['description'])
      .where('stoppage_code', 'in', candidates)
      .executeTakeFirst();
    if (pklRow?.description) return pklRow.description;
    const row = await db.selectFrom('master.stoppage_category')
      .select(['label'])
      .where('category_code', 'in', candidates)
      .executeTakeFirst();
    return row?.label ?? categoryCode;
  }

  static async listStoppageCodes(machine?: string) {
    const rows = await db
      .selectFrom('master.stoppage_code')
      .select(['stoppage_code', 'description', 'applies_to'])
      .where('is_active', '=', true)
      .orderBy('stoppage_code', 'asc')
      .execute();

    const { matchesMachineClassification } = await import('@m1/shared-validation');
    const filtered = machine
      ? rows.filter((r) => matchesMachineClassification(r.applies_to, machine))
      : rows;

    return filtered.map((r) => ({
      stoppageCode: r.stoppage_code,
      description: r.description,
      appliesTo: r.applies_to,
    }));
  }

  /** Idle-machine manual stoppage (no active PKL coil) — mirrors CRM SixHiService. */
  static async getManualStoppageStatus() {
    const machineCode = 'PKL';
    const activeOrder = await this.findActiveMachineOrder();
    const currentEvent = await MachineStateEventService.getCurrentEvent(machineCode);
    const isManualStoppage = Boolean(
      currentEvent
      && currentEvent.event_type === 'STOPPAGE_STARTED'
      && !currentEvent.batch_number,
    );

    if (!isManualStoppage || !currentEvent) {
      return { eligible: !activeOrder, active: null as null };
    }

    const meta = this.parseMachineEventMeta(currentEvent.meta);
    const categoryLabel = await this.resolveStoppageCategoryLabel(currentEvent.category_code);

    return {
      eligible: !activeOrder,
      active: {
        eventId: String(currentEvent.event_id),
        categoryCode: currentEvent.category_code ?? undefined,
        categoryLabel,
        breakdownCode: typeof meta.breakdownCode === 'string' ? meta.breakdownCode : undefined,
        reason: currentEvent.reason ?? undefined,
        startedAt: new Date(currentEvent.occurred_at).toISOString(),
        shiftCode: currentEvent.shift_code ?? undefined,
      },
    };
  }

  static async startManualStoppage(
    categoryCode: string,
    breakdownCode: string | undefined,
    remarks: string | undefined,
    userId: number,
  ) {
    const machineCode = 'PKL';
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);

    const activeOrder = await this.findActiveMachineOrder();
    if (activeOrder) {
      throw new Error('Cannot record manual stoppage while a production order is in progress');
    }

    const currentEvent = await MachineStateEventService.getCurrentEvent(machineCode);
    if (currentEvent?.event_type === 'STOPPAGE_STARTED' && !currentEvent.batch_number) {
      throw new Error('A manual stoppage is already active on this machine');
    }

    const shift = await ShiftDetectionService.resolveShift({ userId, machineCode });
    const startAt = new Date();
    await db.insertInto('txn.stoppage')
      .values({
        machine_code: machineCode,
        category_code: categoryCode,
        breakdown_code: breakdownCode ?? null,
        remarks: remarks ?? null,
        operator_id: userId,
        start_at: startAt,
        shift_log_id: shift.shiftLogId,
        shift_code: shift.shiftCode,
        prod_date: postgresDateOnly(shift.prodDate),
      })
      .execute();

    await MachineStateEventService.recordEvent(machineCode, 'STOPPAGE_STARTED', {
      operatorId: userId,
      shiftCode: shift.shiftCode,
      categoryCode,
      reason: remarks,
      meta: { manual: true, breakdownCode: breakdownCode ?? null },
    });

    return this.getManualStoppageStatus();
  }

  static async updateManualStoppage(
    categoryCode: string,
    breakdownCode: string | undefined,
    remarks: string | undefined,
  ) {
    const machineCode = 'PKL';
    const currentEvent = await MachineStateEventService.getCurrentEvent(machineCode);
    if (!currentEvent || currentEvent.event_type !== 'STOPPAGE_STARTED' || currentEvent.batch_number) {
      throw new Error('No active manual stoppage on this machine');
    }

    const meta = this.parseMachineEventMeta(currentEvent.meta);
    await MachineStateEventService.updateOpenEvent(currentEvent.event_id, {
      categoryCode,
      reason: remarks,
      meta: {
        ...meta,
        manual: true,
        breakdownCode: breakdownCode ?? meta.breakdownCode ?? null,
      },
    });

    await db.updateTable('txn.stoppage')
      .set({
        category_code: categoryCode,
        breakdown_code: breakdownCode ?? null,
        remarks: remarks ?? null,
      })
      .where('machine_code', '=', machineCode)
      .where('order_id', 'is', null)
      .where('end_at', 'is', null)
      .$if(Boolean(currentEvent.shift_code), (qb) =>
        qb.where('shift_code', '=', currentEvent.shift_code!),
      )
      .execute();

    return this.getManualStoppageStatus();
  }

  static async endManualStoppage(userId: number) {
    const machineCode = 'PKL';
    const currentEvent = await MachineStateEventService.getCurrentEvent(machineCode);
    if (!currentEvent || currentEvent.event_type !== 'STOPPAGE_STARTED' || currentEvent.batch_number) {
      throw new Error('No active manual stoppage on this machine');
    }

    const shiftCode = currentEvent.shift_code ?? undefined;
    const endAt = new Date();
    let openManualQ = db.selectFrom('txn.stoppage')
      .select(['stoppage_id', 'start_at'])
      .where('machine_code', '=', machineCode)
      .where('order_id', 'is', null)
      .where('end_at', 'is', null)
      .orderBy('start_at', 'desc');
    if (shiftCode) {
      openManualQ = openManualQ.where('shift_code', '=', shiftCode);
    }
    const openManual = await openManualQ.executeTakeFirst();
    if (openManual) {
      const durationMin = resolveStoppageMinutes(openManual.start_at as Date, endAt, null);
      await db.updateTable('txn.stoppage')
        .set({ end_at: endAt, duration_min: durationMin })
        .where('stoppage_id', '=', openManual.stoppage_id)
        .execute();
    }

    await MachineStateEventService.recordEvent(machineCode, 'STOPPAGE_ENDED', {
      operatorId: userId,
      shiftCode,
    });
    await MachineStateEventService.recordEvent(machineCode, 'IDLE_STARTED', {
      operatorId: userId,
      shiftCode,
    });

    return this.getManualStoppageStatus();
  }
}
