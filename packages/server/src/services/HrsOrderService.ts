/**
 * HRS line order lifecycle over txn.hrs_order.
 * Mirrors RewindingOrderService, keyed by mother coil_no (N slits/orderLines per coil).
 * No combine, no machine allocation — HRS has a single line.
 */
import { formatPlantDate, postgresDateOnly, PLANT_TIME_ZONE } from '@m1/shared-validation';
import { sql } from 'kysely';
import { db } from '../db';
import { getTenantId } from '../context';
import { ShiftDetectionService } from './ShiftDetectionService';
import { MachineStateEventService } from './MachineStateEventService';
import { resolveStoppageMinutes } from '../validation/manufacturingValidation';
import { netProdDurationMin } from '../utils/orderLifecycleHelpers';
import {
  assertCompletedHrsPklProd,
  emitProductionCaptured,
  rewindCompletedLineIfNextIdle,
} from './journeyHandoff';

export type HrsOrderStatus =
  | 'PENDING'
  | 'PREPARING'
  | 'IN_PROGRESS'
  | 'STOPPAGE'
  | 'COMPLETED'
  | 'REJECTED';

export type HrsOrderLine = {
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
};

export type HrsQueueCard = {
  coilNo: string;
  displayCoilNo?: string;
  gradeCode: string;
  customerName: string;
  widthMm: number;
  thicknessMm: number;
  weightMt: number;
  status: HrsOrderStatus;
  machineCode: 'HRS';
  orderLines?: HrsOrderLine[];
  lineCount?: number;
  combination?: string;
  journeyId?: string;
  stepNo?: number;
  routeRaw?: string;
};

export type HrsOrderDetail = {
  orderId: string;
  coilNo: string;
  customerName: string;
  gradeCode: string;
  widthMm: number;
  thicknessMm: number;
  weightMt: number;
  machineCode: 'HRS';
  status: HrsOrderStatus;
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
  orderLines?: HrsOrderLine[];
};

const HRS_PROCESS_CODE = 'HRS';

export class HrsOrderService {
  private static parseMachineEventMeta(meta: unknown): Record<string, unknown> {
    if (meta && typeof meta === 'object') return meta as Record<string, unknown>;
    if (typeof meta === 'string') {
      try {
        const parsed = JSON.parse(meta);
        if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
      } catch {
        /* ignore malformed meta */
      }
    }
    return {};
  }

  private static async resolveStoppageCategoryLabel(categoryCode?: string | null): Promise<string | undefined> {
    if (!categoryCode) return undefined;
    const row = await db.selectFrom('master.stoppage_category')
      .select(['label'])
      .where('category_code', '=', categoryCode)
      .executeTakeFirst();
    return row?.label ?? categoryCode;
  }

  static async getProcessId(): Promise<number> {
    const row = await db
      .selectFrom('master.process')
      .select('process_id')
      .where('code', '=', HRS_PROCESS_CODE)
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

  /** HRS order-lines: plan slits for the mother coil (ppc_hrs_slit, else legacy ppc_batch rows). */
  static async loadOrderLines(coilNo: string): Promise<HrsOrderLine[]> {
    // New import path: one mother ppc_batch + N rows in planning.ppc_hrs_slit.
    const slitRows = await sql<{
      slit_label: string;
      width_mm: string | number | null;
      weight_mt: string | number | null;
      finish_thk_mm: string | number | null;
      process_route_raw: string | null;
      customer_name: string | null;
      child_coil_no: string | null;
      sap_order_no: string | null;
      batch_number: string | null;
      input_thk_mm: string | number | null;
      roll_finish: string | null;
      to_work_center: string | null;
    }>`
      SELECT
        s.slit_label,
        s.width_mm,
        s.weight_mt,
        s.finish_thk_mm,
        s.process_route_raw,
        s.customer_name,
        s.child_coil_no,
        s.sap_order_no,
        b.batch_number,
        b.input_thk_mm,
        b.roll_finish,
        b.to_work_center
      FROM planning.ppc_hrs_slit s
      INNER JOIN planning.ppc_batch b ON b.batch_id = s.batch_id
      WHERE b.coil_no = ${coilNo}
        AND (
          b.machine_code = 'HRS'
          OR b.sub_process = 'HRS'
          OR b.from_work_center IN ('S', 'HRS')
        )
      ORDER BY s.slit_no ASC
    `.execute(db);

    if (slitRows.rows.length > 0) {
      return slitRows.rows.map((l) => ({
        batchNumber: l.sap_order_no ?? l.batch_number ?? undefined,
        widthMm: l.width_mm != null ? Number(l.width_mm) : undefined,
        weightMt: l.weight_mt != null ? Number(l.weight_mt) : undefined,
        thicknessMm: l.input_thk_mm != null ? Number(l.input_thk_mm) : undefined,
        finishThicknessMm: l.finish_thk_mm != null ? Number(l.finish_thk_mm) : undefined,
        customerName: l.customer_name ?? undefined,
        routeRaw: l.process_route_raw ?? undefined,
        slitId: l.slit_label ?? undefined,
        surfaceFinish: l.roll_finish ?? undefined,
        toWorkCenter: l.to_work_center ?? undefined,
      }));
    }

    // Legacy: multiple HRS ppc_batch rows per mother coil (pre slit-table import).
    const lines = await db
      .selectFrom('planning.ppc_batch')
      .select([
        'batch_number', 'width_mm', 'customer_name', 'process_route_raw',
        'machine_code', 'slit_id', 'ppc_weight_mt', 'finish_thk_mm',
        'input_thk_mm', 'to_work_center', 'roll_finish',
      ])
      .where('coil_no', '=', coilNo)
      .where((eb) =>
        eb.or([
          eb('machine_code', '=', 'HRS'),
          eb('sub_process', '=', 'HRS'),
          eb('from_work_center', 'in', ['S', 'HRS']),
        ]),
      )
      .orderBy('slit_id', 'asc')
      .orderBy('batch_number', 'asc')
      .execute();

    return lines.map((l) => ({
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
    }));
  }

  /** Ensure hrs_order row exists for a mother coil. */
  static async ensureOrder(coilNo: string, userId: number): Promise<string> {
    const existing = await db
      .selectFrom('txn.hrs_order')
      .select('order_id')
      .where('coil_no', '=', coilNo)
      .executeTakeFirst();
    if (existing) return String(existing.order_id);

    const coil = await db
      .selectFrom('coil.coil as c')
      .leftJoin('master.customer as cu', 'cu.customer_id', 'c.customer_id')
      .select([
        'c.coil_no', 'c.grade_code', 'c.nominal_width_mm', 'c.coil_width_mm',
        'c.coil_thk_mm', 'c.weight_mt', 'cu.customer_name',
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
          eb('machine_code', '=', 'HRS'),
          eb('sub_process', '=', 'HRS'),
          eb('from_work_center', 'in', ['S', 'HRS']),
        ]),
      )
      .orderBy('slit_id', 'asc')
      .orderBy('batch_number', 'asc')
      .executeTakeFirst();

    const detected = await ShiftDetectionService.getCurrentShift({
      userId,
      machineCode: 'HRS',
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
      .where('ojs.process_code', '=', 'HRS')
      .where('ojs.status', '=', 'ACTIVE')
      .executeTakeFirst();

    const order = await db
      .insertInto('txn.hrs_order')
      .values({
        coil_no: coilNo,
        customer_name: firstBatch?.customer_name ?? coil.customer_name ?? 'Unknown',
        grade_code: firstBatch?.grade_code ?? coil.grade_code ?? 'NA',
        nominal_width_mm: firstBatch?.width_mm ?? coil.nominal_width_mm ?? coil.coil_width_mm ?? 0,
        nominal_thk_mm: firstBatch?.input_thk_mm ?? firstBatch?.ppc_thk_mm ?? coil.coil_thk_mm ?? 0,
        mother_coil_weight_mt: firstBatch?.ppc_weight_mt ?? coil.weight_mt ?? 0,
        machine_code: 'HRS',
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

  static async getOrder(coilNo: string, userId: number): Promise<HrsOrderDetail> {
    await this.ensureOrder(coilNo, userId);
    const order = await db
      .selectFrom('txn.hrs_order')
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
      .where('hrs_order_id', '=', order.order_id)
      .where('order_kind', '=', 'HRS')
      .orderBy('start_at', 'desc')
      .execute();

    const active = stoppages.find((s) => !s.end_at);
    let status = order.status as HrsOrderStatus;
    if (status === 'STOPPAGE' && !active) {
      status = order.prod_start_at ? 'IN_PROGRESS' : 'PENDING';
      await db
        .updateTable('txn.hrs_order')
        .set({ status, updated_at: new Date() })
        .where('order_id', '=', order.order_id)
        .where('status', '=', 'STOPPAGE')
        .execute();
    }

    const orderLines = await this.loadOrderLines(coilNo);

    return {
      orderId: String(order.order_id),
      coilNo: order.coil_no,
      customerName: order.customer_name,
      gradeCode: order.grade_code,
      widthMm: Number(order.nominal_width_mm),
      thicknessMm: Number(order.nominal_thk_mm),
      weightMt: Number(order.mother_coil_weight_mt),
      machineCode: 'HRS',
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
      orderLines,
    };
  }

  static async getQueue(userId: number): Promise<{ queue: HrsQueueCard[] }> {
    const rows = await db
      .selectFrom('planning.order_journey as oj')
      .innerJoin('planning.order_journey_step as ojs', (join) =>
        join.onRef('ojs.journey_id', '=', 'oj.journey_id').onRef('ojs.step_no', '=', 'oj.current_step_no'),
      )
      .select(['oj.journey_id', 'oj.coil_no', 'ojs.step_no'])
      .where('oj.status', 'in', ['ACTIVE', 'HOLD'])
      .where('ojs.process_code', '=', 'HRS')
      .where('ojs.status', 'in', ['PENDING', 'ACTIVE', 'HOLD'])
      .orderBy('ojs.started_at', 'asc')
      .orderBy('oj.journey_id', 'asc')
      .execute();

    const queue: HrsQueueCard[] = [];
    const seenCoils = new Set<string>();

    const pushOrder = async (
      order: {
        coil_no: string;
        grade_code: string | null;
        customer_name: string | null;
        nominal_width_mm: number | string | null;
        nominal_thk_mm: number | string | null;
        mother_coil_weight_mt: number | string | null;
        status: string;
      },
      extra?: { journeyId?: string; stepNo?: number },
    ) => {
      if (seenCoils.has(order.coil_no)) return;
      seenCoils.add(order.coil_no);
      const orderLines = await this.loadOrderLines(order.coil_no);
      const routeRaw = orderLines.find((ol) => ol.routeRaw)?.routeRaw;
      queue.push({
        coilNo: order.coil_no,
        gradeCode: order.grade_code ?? '',
        customerName: order.customer_name ?? '',
        widthMm: Number(order.nominal_width_mm),
        thicknessMm: Number(order.nominal_thk_mm),
        weightMt: Number(order.mother_coil_weight_mt),
        status: order.status as HrsOrderStatus,
        machineCode: 'HRS',
        orderLines,
        lineCount: Math.max(1, orderLines.length),
        combination: orderLines.length
          ? orderLines.map((ol) => (ol.widthMm != null ? String(ol.widthMm) : '?')).join('+')
          : undefined,
        journeyId: extra?.journeyId,
        stepNo: extra?.stepNo,
        routeRaw,
      });
    };

    for (const row of rows) {
      await this.ensureOrder(row.coil_no, userId);
      const order = await db
        .selectFrom('txn.hrs_order')
        .selectAll()
        .where('coil_no', '=', row.coil_no)
        .executeTakeFirstOrThrow();
      await pushOrder(order, { journeyId: String(row.journey_id), stepNo: row.step_no });
    }

    const extraOrders = await db
      .selectFrom('txn.hrs_order')
      .selectAll()
      .where('status', 'in', ['PENDING', 'PREPARING', 'IN_PROGRESS', 'STOPPAGE', 'REJECTED'])
      .execute();
    for (const order of extraOrders) {
      await pushOrder(order);
    }

    // Completed for current plant day — status pill parity with PKL/Rolling.
    const shift = await ShiftDetectionService.getCurrentShift({ userId, machineCode: 'HRS' });
    const prodDate = postgresDateOnly(shift.prodDate);
    const completed = await db
      .selectFrom('txn.hrs_order')
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
      .where('hrs_order_id', '=', orderId as any)
      .where('order_kind', '=', 'HRS')
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
      .where('hrs_order_id', '=', orderId as any)
      .where('order_kind', '=', 'HRS')
      .where('end_at', 'is', null)
      .executeTakeFirst();
    if (open) throw new Error('Close open stoppage before continuing');
  }

  private static async findActiveMachineOrder() {
    const row = await db
      .selectFrom('txn.hrs_order')
      .select(['coil_no', 'order_id', 'status'])
      .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .executeTakeFirst();
    return row ? { coilNo: row.coil_no, orderId: row.order_id, status: row.status } : null;
  }

  static async startProduction(coilNo: string, userId: number): Promise<HrsOrderDetail> {
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed('HRS', userId);

    const active = await this.findActiveMachineOrder();
    if (active && active.coilNo !== coilNo) {
      throw new Error(`ACTIVE_ORDER_CONFLICT:${active.coilNo}`);
    }

    const orderId = await this.ensureOrder(coilNo, userId);
    const orderRow = await db
      .selectFrom('txn.hrs_order')
      .select(['order_id', 'status', 'coil_no', 'prod_start_at', 'shift_code'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();

    if (orderRow.status === 'IN_PROGRESS') return this.getOrder(coilNo, userId);

    if (orderRow.status === 'STOPPAGE') {
      await this.assertNoOpenStoppage(orderId);
      await db
        .updateTable('txn.hrs_order')
        .set({ status: 'IN_PROGRESS', updated_at: new Date() })
        .where('order_id', '=', orderId as any)
        .where('status', '=', 'STOPPAGE')
        .execute();
      MachineStateEventService.recordEvent('HRS', 'RUNNING_STARTED', {
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
      .updateTable('txn.hrs_order')
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

    MachineStateEventService.recordEvent('HRS', 'RUNNING_STARTED', {
      orderId,
      operatorId: userId,
      shiftCode: orderRow.shift_code ?? undefined,
    }).catch(() => undefined);

    return this.getOrder(coilNo, userId);
  }

  static async endProduction(coilNo: string, userId: number): Promise<HrsOrderDetail> {
    const order = await db
      .selectFrom('txn.hrs_order')
      .selectAll()
      .where('coil_no', '=', coilNo)
      .executeTakeFirstOrThrow();
    if (order.status !== 'IN_PROGRESS' && order.status !== 'STOPPAGE') {
      throw new Error('Only running orders can be completed');
    }

    await this.assertNoOpenStoppage(order.order_id);

    // G2 parity: End without final Save strands journey (draft = IN_PROGRESS, no emit).
    const prod = await assertCompletedHrsPklProd('HRS', coilNo, order.shift_log_id);

    const endAt = new Date();
    const stopMin = await this.totalStoppageMinutes(order.order_id, endAt);
    const duration = order.prod_start_at
      ? netProdDurationMin(new Date(order.prod_start_at), endAt, stopMin)
      : 0;
    const shift = await ShiftDetectionService.getCurrentShift({ userId, machineCode: 'HRS' });
    const prodDate = postgresDateOnly(shift.prodDate);

    await db
      .updateTable('txn.hrs_order')
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

    // Idempotent safety-net: re-drive advance if production.captured was lost.
    await emitProductionCaptured('HRS', prod.shiftLogId, prod.entryId, coilNo);

    MachineStateEventService.recordEvent('HRS', 'RUNNING_ENDED', {
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
  ): Promise<HrsOrderDetail> {
    const orderId = await this.ensureOrder(coilNo, userId);
    const orderRow = await db
      .selectFrom('txn.hrs_order')
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
        .where('hrs_order_id', '=', orderId as any)
        .where('order_kind', '=', 'HRS')
        .where('end_at', 'is', null)
        .executeTakeFirst();
      if (open) return;

      await trx
        .insertInto('txn.stoppage')
        .values({
          order_id: null,
          hrs_order_id: orderId as any,
          order_kind: 'HRS',
          category_code: categoryCode,
          breakdown_code: breakdownCode ?? null,
          remarks: remarks ?? null,
          operator_id: userId,
          start_at: startAt,
          shift_log_id: orderRow.shift_log_id,
          shift_code: orderRow.shift_code,
          prod_date: orderRow.prod_date,
          machine_code: 'HRS',
          tenant_id: getTenantId() || '00000000-0000-0000-0000-000000000001',
        } as any)
        .execute();

      await trx
        .updateTable('txn.hrs_order')
        .set({ status: 'STOPPAGE', updated_at: startAt })
        .where('order_id', '=', orderId as any)
        .execute();
    });

    MachineStateEventService.recordEvent('HRS', 'STOPPAGE_STARTED', {
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
  ): Promise<HrsOrderDetail> {
    const orderId = await this.ensureOrder(coilNo, userId);
    const stop = await db
      .selectFrom('txn.stoppage')
      .selectAll()
      .where('stoppage_id', '=', stoppageId as any)
      .where('hrs_order_id', '=', orderId as any)
      .executeTakeFirst();
    if (!stop) throw new Error('Stoppage not found');
    if (stop.end_at) return this.getOrder(coilNo, userId);

    const endAt = new Date();
    const order = await db
      .selectFrom('txn.hrs_order')
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
        .updateTable('txn.hrs_order')
        .set({ status: 'IN_PROGRESS', updated_at: endAt })
        .where('order_id', '=', orderId as any)
        .where('status', '=', 'STOPPAGE')
        .execute();
    });

    MachineStateEventService.recordEvent('HRS', 'STOPPAGE_ENDED', {
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
  ): Promise<HrsOrderDetail> {
    const orderId = await this.ensureOrder(coilNo, userId);
    await db
      .updateTable('txn.stoppage')
      .set({
        category_code: categoryCode,
        breakdown_code: breakdownCode ?? null,
        remarks: remarks ?? null,
      })
      .where('stoppage_id', '=', stoppageId as any)
      .where('hrs_order_id', '=', orderId as any)
      .execute();
    return this.getOrder(coilNo, userId);
  }

  static async rejectOrder(
    coilNo: string,
    rejectionReason: string,
    remarks: string,
    userId: number,
  ): Promise<HrsOrderDetail> {
    if (!rejectionReason?.trim()) throw new Error('Hold reason is required');
    if (!remarks?.trim()) throw new Error('Hold remarks are required');

    const orderId = await this.ensureOrder(coilNo, userId);
    const current = await db
      .selectFrom('txn.hrs_order')
      .select(['status'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();

    if (current.status === 'REJECTED') return this.getOrder(coilNo, userId);

    const heldAt = new Date();
    await db.transaction().execute(async (trx) => {
      const open = await trx
        .selectFrom('txn.stoppage')
        .select(['stoppage_id', 'start_at'])
        .where('hrs_order_id', '=', orderId as any)
        .where('order_kind', '=', 'HRS')
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
        .updateTable('txn.hrs_order')
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
  ): Promise<HrsOrderDetail> {
    const orderId = await this.ensureOrder(coilNo, userId);
    const order = await db
      .selectFrom('txn.hrs_order')
      .select(['status'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();
    if (order.status !== 'REJECTED' && order.status !== 'COMPLETED') {
      throw new Error('Only held or completed orders can be reinstated');
    }
    if (order.status === 'COMPLETED') {
      await rewindCompletedLineIfNextIdle(coilNo, 'HRS');
    }

    const patch: {
      status: 'PREPARING' | 'PENDING';
      hold_reason: null;
      hold_remarks: null;
      held_at: null;
      held_by: null;
      prod_end_at: null;
      prod_start_at?: null;
      updated_at: Date;
    } = {
      status: target,
      hold_reason: null,
      hold_remarks: null,
      held_at: null,
      held_by: null,
      prod_end_at: null,
      updated_at: new Date(),
    };
    if (order.status === 'COMPLETED') patch.prod_start_at = null;

    await db
      .updateTable('txn.hrs_order')
      .set(patch)
      .where('order_id', '=', orderId as any)
      .execute();

    return this.getOrder(coilNo, userId);
  }

  static async deleteOrder(coilNo: string, _userId: number): Promise<{ coilNo: string }> {
    const order = await db
      .selectFrom('txn.hrs_order')
      .select(['order_id', 'status', 'coil_no'])
      .where('coil_no', '=', coilNo)
      .executeTakeFirst();
    if (!order) throw new Error('Order not found');
    const deletable = ['PENDING', 'PREPARING', 'IN_PROGRESS', 'STOPPAGE', 'COMPLETED', 'REJECTED'];
    if (!deletable.includes(order.status)) {
      throw new Error(`Orders with status ${order.status} cannot be deleted`);
    }
    if (order.status === 'COMPLETED') {
      await rewindCompletedLineIfNextIdle(coilNo, 'HRS');
    }

    const now = new Date();
    await db
      .updateTable('txn.stoppage')
      .set({ end_at: now, duration_min: 0 })
      .where('hrs_order_id', '=', order.order_id as any)
      .where('end_at', 'is', null)
      .execute();

    if (order.status === 'IN_PROGRESS' || order.status === 'STOPPAGE') {
      MachineStateEventService.recordEvent('HRS', 'RUNNING_ENDED', {
        orderId: order.order_id,
        meta: { coilNo },
      }).catch(() => undefined);
      MachineStateEventService.recordEvent('HRS', 'IDLE_STARTED').catch(() => undefined);
    }

    await db.deleteFrom('txn.hrs_order').where('order_id', '=', order.order_id as any).execute();
    await db.updateTable('coil.coil').set({ status: 'PLANNED' }).where('coil_no', '=', coilNo).execute();
    return { coilNo };
  }

  /** Idle-machine manual stoppage for HRS when no order is running. */
  static async getManualStoppageStatus() {
    const machineCode = 'HRS';
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
    const machineCode = 'HRS';
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);
    const activeOrder = await this.findActiveMachineOrder();
    if (activeOrder) throw new Error('Cannot record manual stoppage while a production order is in progress');
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
    const machineCode = 'HRS';
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
      .where('hrs_order_id', 'is', null)
      .where('order_id', 'is', null)
      .where('end_at', 'is', null)
      .$if(Boolean(currentEvent.shift_code), (qb) => qb.where('shift_code', '=', currentEvent.shift_code!))
      .execute();
    return this.getManualStoppageStatus();
  }

  static async endManualStoppage(userId: number) {
    const machineCode = 'HRS';
    const currentEvent = await MachineStateEventService.getCurrentEvent(machineCode);
    if (!currentEvent || currentEvent.event_type !== 'STOPPAGE_STARTED' || currentEvent.batch_number) {
      throw new Error('No active manual stoppage on this machine');
    }
    const shiftCode = currentEvent.shift_code ?? undefined;
    const endAt = new Date();
    let openManualQ = db.selectFrom('txn.stoppage')
      .select(['stoppage_id', 'start_at'])
      .where('machine_code', '=', machineCode)
      .where('hrs_order_id', 'is', null)
      .where('order_id', 'is', null)
      .where('end_at', 'is', null)
      .orderBy('start_at', 'desc');
    if (shiftCode) openManualQ = openManualQ.where('shift_code', '=', shiftCode);
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
