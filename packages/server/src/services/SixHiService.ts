import { sql, type Kysely, type Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import type {
  SixHiOrderDetail,
  SixHiQueueCard,
  SixHiRollingData,
  SixHiShiftSummary,
  SixHiSkinPassData,
  SixHiSubProcess,
} from '@m1/shared-validation';
import { db, type Database } from '../db';
import { loadOrderRejection } from './orderRejectionLoader';
import { parseCrmMillCode, ROLLING_MILLS, CrmMillCode, assertMachineForSubProcess, assertMachineClaimOrIdempotent } from '../utils/machineAllocation';
import { throwVersionConflict } from '../utils/versionConflict';
import { PPCImportService } from '../services/PPCImportService';
import { ValidationConfigService } from './ValidationConfigService';
import { computeEffectiveRuleset, evaluateRules } from '@m1/shared-validation';
import {
  allocateCombinedRemainderToBlanks,
} from '@m1/shared-validation';
import { getTenantId } from '../context';
import { ShiftDetectionService } from './ShiftDetectionService';
import { ProcessRouteService } from './ProcessRouteService';
import { MachineRegistryService } from './MachineRegistryService';
import { formatPlantDate, parsePlantDateOnly, postgresDateOnly } from '@m1/shared-validation';
import { MachineStateEventService } from './MachineStateEventService';
import { earlierShiftCodesOnSameDay } from './sixHi/shiftCycle';
import {
  ensureOrderMachineTransferTable,
  loadRecentOrderMachineTransfersGlobal,
  recordOrderMachineTransfer,
} from './orderMachineTransferAudit';
import {
  validateOrderStoppageInterval,
  validateOrderStoppageStart,
} from '../validation/orderStoppageValidation';
import { resolveStoppageMinutes } from '../validation/manufacturingValidation';
import { finishGroup } from '../utils/orderLifecycleHelpers';
import {
  actualWeightOcrDbPatch,
  assertActualWeightOcrCapture,
  assertCrm6DefectQuantities,
  assertCrm6OutputWeight,
  assertCrm6ScrapKg,
  mapActualWeightOcrFields,
  assertOrderRuntimeAccounting,
  assertShiftLogRuntimeAccounting,
} from '../validation/crm6ProductionValidation';

const SIX_HI_PROCESS_CODE = 'ROLLING';

function mapDestination(raw: string | null): 'REWINDING' | 'ANNEALING' {
  return raw === 'REWINDING' ? 'REWINDING' : 'ANNEALING';
}

function mapRollFinish(raw: string | null): 'MATT' | 'BRIGHT' | 'LOW_MATT' {
  if (raw === 'BRIGHT') return 'BRIGHT';
  if (raw === 'LOW_MATT') return 'LOW_MATT';
  return 'MATT';
}

type DbExecutor = Kysely<Database> | Transaction<Database>;

const SIXHI_HOLD_MAX_ROWS = Number(process.env.SIXHI_HOLD_MAX_ROWS ?? 50);

export class SixHiService {
  static async getProcessId(): Promise<number> {
    // DB seed uses CRM; some envs alias ROLLING — accept either (same as ShiftDetectionService).
    const p =
      (await db.selectFrom('master.process').select('process_id').where('code', '=', SIX_HI_PROCESS_CODE).executeTakeFirst()) ??
      (await db.selectFrom('master.process').select('process_id').where('code', '=', 'CRM').executeTakeFirst());
    if (!p) throw new Error('6HI process not configured (expected ROLLING or CRM)');
    return p.process_id;
  }

  static async ensureActiveShiftLog(userId: number, planDate?: string | Date, shiftCode?: string): Promise<string> {
    // Same resolver as dashboards / reattribution (mill_type IS NULL) so orders
    // are not pinned to a random mill-specific sibling of the same date/shift.
    const processId = await this.getProcessId();
    const resolved = await ShiftDetectionService.resolveShift({
      planDate: planDate != null ? postgresDateOnly(planDate) : formatPlantDate(new Date()),
      shiftCode: shiftCode ?? 'B',
      processId,
      userId,
    });
    return resolved.shiftLogId;
  }

  /**
   * Re-attribute an order to the operator's actual active shift when production begins.
   *
   * Orders are seeded (at creation) with the PLANNED shift copied from the PPC batch.
   * For a backlog order (planned for a previous day/shift but produced today) that
   * planned attribution is wrong: production must be credited to the shift where it
   * actually ran. This MOVES the order (and its child/attribution rows) to the current
   * active shift — it is never duplicated — and refreshes the cached production totals
   * of both the previous and the new shift so no double counting can occur.
   *
   * The current active shift is resolved via ShiftDetectionService
   * (ACTIVE machine session → override → clock). An open session past the
   * clock boundary stays pinned so overtime production is not reattributed.
   *
   * @returns the authoritative shift_log_id the order is attributed to, or null.
   */
  static async reattributeOrderToActiveShift(
    orderId: string | number,
    userId: number,
    machineCode?: string,
  ): Promise<string | null> {
    const id = String(orderId);
    const current = await db.selectFrom('txn.crm_order')
      .select(['shift_log_id'])
      .where('order_id', '=', id)
      .executeTakeFirst();
    if (!current) return null;

    const processId = await this.getProcessId();
    const resolved = await ShiftDetectionService.resolveShift({
      userId,
      machineCode,
      processId,
      requireCallerSession: Boolean(machineCode),
    });
    const targetShiftLogId = resolved.shiftLogId;
    const prodDate = postgresDateOnly(resolved.prodDate);
    const shiftCode = resolved.shiftCode.toUpperCase();
    const oldShiftLogId = current.shift_log_id != null ? String(current.shift_log_id) : null;

    // No-op when the order is already attributed to the active shift (normal same-shift orders).
    if (oldShiftLogId === String(targetShiftLogId)) {
      return String(targetShiftLogId);
    }

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('txn.crm_order')
        .set({
          shift_log_id: targetShiftLogId,
          prod_date: prodDate,
          production_day: prodDate,
          shift_code: shiftCode,
          updated_at: new Date(),
        } as any)
        .where('order_id', '=', id)
        .execute();

      await trx.updateTable('txn.crm_rolling')
        .set({ shift_code: shiftCode, prod_date: prodDate } as any)
        .where('order_id', '=', id)
        .execute();

      // Move stoppages with the order so shift totals stay consistent.
      await trx.updateTable('txn.stoppage')
        .set({
          shift_log_id: targetShiftLogId,
          shift_code: shiftCode,
          prod_date: prodDate,
        } as any)
        .where('order_id', '=', id)
        .execute();
    });

    const { ShiftAttributionService } = await import('./ShiftAttributionService');
    // Move existing attribution slice(s) with the order, then upsert via single writer.
    await db.updateTable('txn.order_shift_attribution')
      .set({ shift_log_id: targetShiftLogId, shift_code: shiftCode, prod_date: prodDate } as any)
      .where('order_id', '=', id)
      .execute()
      .catch((err) => console.error('[SixHi] reattribute attribution slice move failed:', err));
    await ShiftAttributionService.attributeOrder(id, targetShiftLogId, { machineCode });

    // Recompute cached production totals for BOTH shifts: the old shift must no longer
    // count this order, the new shift must now include it.
    if (oldShiftLogId) {
      await this.syncShiftProductionCache(oldShiftLogId).catch((err) =>
        console.error('[SixHi] reattribute old-shift cache refresh failed:', err));
    }
    await this.syncShiftProductionCache(String(targetShiftLogId)).catch((err) =>
      console.error('[SixHi] reattribute new-shift cache refresh failed:', err));

    return String(targetShiftLogId);
  }

  private static async totalStoppageMinutes(orderId: number | string, asOf: Date = new Date()): Promise<number> {
    const id = String(orderId);
    const stops = await db.selectFrom('txn.stoppage')
      .select(['start_at', 'end_at', 'duration_min'])
      .where('order_id', '=', id)
      .execute();
    let total = 0;
    for (const s of stops) {
      total += resolveStoppageMinutes(s.start_at, s.end_at ?? asOf, s.duration_min, asOf.getTime());
    }
    return total;
  }

  private static async assertNoOpenStoppage(orderId: number | string): Promise<void> {
    const id = String(orderId);
    const open = await db.selectFrom('txn.stoppage')
      .select(db.fn.count('stoppage_id').as('c'))
      .where('order_id', '=', id)
      .where('end_at', 'is', null)
      .executeTakeFirst();
    if (Number(open?.c ?? 0) > 0) {
      throw new Error('End the active stoppage before continuing');
    }
  }

  /** Members of a combined production group (optional status filter). */
  private static async loadCombinedGroupMembers(
    combinedGroupId: string,
    statuses?: readonly string[],
  ): Promise<Array<{
    order_id: string | number;
    batch_number: string;
    status: string;
    coil_no: string | null;
    prod_start_at: Date | null;
  }>> {
    let query = db.selectFrom('txn.crm_order')
      .select(['order_id', 'batch_number', 'status', 'coil_no', 'prod_start_at'])
      .where('combined_group_id', '=', combinedGroupId);
    if (statuses && statuses.length > 0) {
      query = query.where('status', 'in', [...statuses]);
    }
    return query.execute();
  }

  /**
   * Resolve the order(s) a lifecycle action must touch.
   * Combined groups always expand to every matching member; singles stay alone.
   */
  private static async resolveCombinedLifecycleTargets(
    batchNumber: string,
    statuses?: readonly string[],
  ): Promise<{
    combinedGroupId: string | null;
    targets: Array<{
      order_id: string | number;
      batch_number: string;
      status: string;
      coil_no: string | null;
      prod_start_at: Date | null;
    }>;
  }> {
    const primary = await db.selectFrom('txn.crm_order')
      .select(['order_id', 'batch_number', 'status', 'coil_no', 'prod_start_at', 'combined_group_id'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!primary) {
      throw new Error('Order not found');
    }
    if (!primary.combined_group_id) {
      return {
        combinedGroupId: null,
        targets: [{
          order_id: primary.order_id,
          batch_number: String(primary.batch_number),
          status: primary.status,
          coil_no: primary.coil_no ?? null,
          prod_start_at: primary.prod_start_at ?? null,
        }],
      };
    }
    const members = await this.loadCombinedGroupMembers(String(primary.combined_group_id), statuses);
    return {
      combinedGroupId: String(primary.combined_group_id),
      targets: members.length > 0
        ? members.map((m) => ({
            order_id: m.order_id,
            batch_number: String(m.batch_number),
            status: m.status,
            coil_no: m.coil_no ?? null,
            prod_start_at: m.prod_start_at ?? null,
          }))
        : [{
            order_id: primary.order_id,
            batch_number: String(primary.batch_number),
            status: primary.status,
            coil_no: primary.coil_no ?? null,
            prod_start_at: primary.prod_start_at ?? null,
          }],
    };
  }

  static formatPlanDate(value: Date | string): string {
    return formatPlantDate(value);
  }

  /**
   * Parse YYYY-MM-DD at IST midnight — for clock math only.
   * Do NOT bind the returned Date to Postgres DATE columns (UTC hosts truncate to yesterday).
   * Use postgresDateOnly() / formatPlanDate() for DATE writes and equality filters.
   */
  static toPlanDate(value: string | Date): Date {
    return parsePlantDateOnly(value);
  }

  private static readonly NON_ASSIGNABLE_ORDER_STATUSES = new Set([
    'COMPLETED',
    'REJECTED',
    'IN_PROGRESS',
    'STOPPAGE',
  ]);

  private static readonly INCOMPLETE_ORDER_STATUSES = [
    'PENDING',
    'PREPARING',
    'IN_PROGRESS',
    'STOPPAGE',
  ] as const;

  private static readonly queueBatchRowShape = {} as {
    batch_id: string | number | bigint;
    batch_number: string;
    coil_no: string;
    slit_id: string | null;
    customer_name: string;
    grade_code: string;
    width_mm: number | string;
    input_thk_mm: number | string | null;
    ppc_thk_mm: number | string;
    finish_thk_mm?: number | string | null;
    machine_code: string;
    machine_allocated?: boolean;
    active_rolling_pass_no?: number | null;
    ppc_weight_mt: number | string;
    destination: string | null;
    roll_finish: string | null;
    ppc_reroll_flag: boolean | null;
    plan_date: Date | string;
    shift_code: string;
    queue_seq?: number | null;
  };

  /** Columns used by mapQueueCard / queueBatchRowShape — not selectAll('pb'). */
  private static readonly QUEUE_BATCH_COLS = [
    'pb.batch_id',
    'pb.batch_number',
    'pb.coil_no',
    'pb.slit_id',
    'pb.customer_name',
    'pb.grade_code',
    'pb.width_mm',
    'pb.input_thk_mm',
    'pb.ppc_thk_mm',
    'pb.finish_thk_mm',
    'pb.machine_code',
    'pb.machine_allocated',
    'pb.active_rolling_pass_no',
    'pb.ppc_weight_mt',
    'pb.destination',
    'pb.roll_finish',
    'pb.ppc_reroll_flag',
    'pb.plan_date',
    'pb.shift_code',
    'pb.queue_seq',
  ] as const;

  private static async prefetchQueueCardContext(
    batches: Array<typeof SixHiService.queueBatchRowShape>,
    subProcess: SixHiSubProcess,
  ) {
    const batchIds = [...new Set(batches.map((b) => String(b.batch_id)))];
    if (batchIds.length === 0) {
      return {
        ordersByBatchId: new Map(),
        stoppageLabelByOrderId: new Map<string, string>(),
        rollingByOrderId: new Map(),
        rollingPassCountByOrderId: new Map<string, number>(),
        skinpassByOrderId: new Map(),
      };
    }

    const orders = await db.selectFrom('txn.crm_order')
      .select(['order_id', 'batch_id', 'status', 'prod_duration_min'])
      .where('batch_id', 'in', batchIds)
      .execute();
    type OrderRow = (typeof orders)[number];
    const ordersByBatchId = new Map<string, OrderRow>(orders.map((o) => [String(o.batch_id), o]));
    const orderIds = orders.map((o) => o.order_id);

    const prepOrderIds = orders
      .filter((o) => o.status === 'PENDING' || o.status === 'PREPARING')
      .map((o) => o.order_id);

    const [openStops, rollingRows, passCounts, skinpassRows] = await Promise.all([
      orderIds.length === 0
        ? []
        : db.selectFrom('txn.stoppage as os')
          .innerJoin('master.stoppage_category as sc', 'os.category_code', 'sc.category_code')
          .select(['os.order_id', 'sc.label'])
          .where('os.order_id', 'in', orderIds)
          .where('os.end_at', 'is', null)
          .execute(),
      subProcess === 'ROLLING' && prepOrderIds.length > 0
        ? db.selectFrom('txn.crm_rolling')
          .select(['order_id', 'actual_weight_mt', 'total_passes'])
          .where('order_id', 'in', prepOrderIds)
          .execute()
        : [],
      subProcess === 'ROLLING' && prepOrderIds.length > 0
        ? db.selectFrom('txn.crm_rolling_pass')
          .select(['order_id', sql<number>`count(*)::int`.as('n')])
          .where('order_id', 'in', prepOrderIds)
          .groupBy('order_id')
          .execute()
        : [],
      subProcess === 'SKIN_PASS' && prepOrderIds.length > 0
        ? db.selectFrom('txn.crm_skinpass')
          .select(['order_id', 'output_thk_mm', 'ann_hard', 'operating_mode'])
          .where('order_id', 'in', prepOrderIds)
          .execute()
        : [],
    ]);

    const stoppageLabelByOrderId = new Map(
      openStops.map((row) => [String(row.order_id), String(row.label)]),
    );
    const rollingByOrderId = new Map(
      rollingRows.map((row) => [String(row.order_id), row]),
    );
    const rollingPassCountByOrderId = new Map(
      passCounts.map((row) => [String(row.order_id), Number(row.n ?? 0)]),
    );
    const skinpassByOrderId = new Map(
      skinpassRows.map((row) => [String(row.order_id), row]),
    );

    return {
      ordersByBatchId,
      stoppageLabelByOrderId,
      rollingByOrderId,
      rollingPassCountByOrderId,
      skinpassByOrderId,
    };
  }

  private static mapQueueCard(
    b: typeof SixHiService.queueBatchRowShape,
    subProcess: SixHiSubProcess,
    queuePosition: number,
    ctx: Awaited<ReturnType<typeof SixHiService.prefetchQueueCardContext>>,
    options?: { isBacklog?: boolean },
  ): SixHiQueueCard {
    const order = ctx.ordersByBatchId.get(String(b.batch_id));
    let activeStoppageCategory: string | undefined;
    let prepReady = false;

    if (order) {
      activeStoppageCategory = ctx.stoppageLabelByOrderId.get(String(order.order_id));
      if (order.status === 'PENDING' || order.status === 'PREPARING') {
        if (subProcess === 'ROLLING') {
          const rolling = ctx.rollingByOrderId.get(String(order.order_id));
          const passCount = ctx.rollingPassCountByOrderId.get(String(order.order_id)) ?? 0;
          prepReady = !!(rolling?.actual_weight_mt || passCount > 0 || (rolling?.total_passes ?? 0) > 0);
        } else {
          const sp = ctx.skinpassByOrderId.get(String(order.order_id));
          prepReady = !!(sp?.output_thk_mm || sp?.ann_hard || sp?.operating_mode);
        }
      }
    }

    const inputThk = subProcess === 'SKIN_PASS'
      ? Number(b.input_thk_mm ?? 0)
      : Number(b.input_thk_mm ?? b.ppc_thk_mm);
    const finishThk = b.finish_thk_mm != null ? Number(b.finish_thk_mm) : undefined;
    const allocated = b.machine_allocated ?? true;

    return {
      batchNumber: b.batch_number,
      motherCoil: b.coil_no,
      slitId: b.slit_id ?? undefined,
      customer: b.customer_name,
      grade: b.grade_code,
      widthMm: Number(b.width_mm),
      inputThkMm: inputThk,
      targetThkMm: Number(b.ppc_thk_mm),
      finishThkMm: finishThk,
      machineCode: allocated ? b.machine_code : undefined,
      machineAllocated: allocated,
      suggestedMachineCode: allocated ? undefined : (b.machine_code ?? undefined),
      rollingPassNo: b.active_rolling_pass_no ? Number(b.active_rolling_pass_no) : undefined,
      weightMt: Number(b.ppc_weight_mt),
      destination: b.destination ? mapDestination(b.destination) : undefined,
      rollFinish: b.roll_finish ? mapRollFinish(b.roll_finish) : undefined,
      rerollFlag: b.ppc_reroll_flag ?? false,
      status: (order?.status as SixHiQueueCard['status']) ?? 'PENDING',
      subProcess,
      queuePosition,
      orderId: order ? String(order.order_id) : undefined,
      activeStoppageCategory,
      productionDurationMin: order?.prod_duration_min ?? undefined,
      prepReady,
      planDate: this.formatPlanDate(b.plan_date),
      shiftCode: b.shift_code,
      isBacklog: options?.isBacklog ?? false,
    };
  }

  /**
   * Operator queue for a machine subprocess.
   *
   * @param prodDate Operational production date from shift detection (not PPC plan_date).
   */
  static async getQueue(
    subProcess: SixHiSubProcess,
    prodDate: string,
    shiftCode: string,
    machineCode: string,
    shiftLogId?: string,
    /** PERF-C2: optional assigned-queue page. Omit for full list (exports / legacy). */
    paging?: { limit?: number; cursor?: string },
  ): Promise<{
    prodDate: string;
    shiftCode: string;
    machineCode: string;
    queue: SixHiQueueCard[];
    pendingAllocation: SixHiQueueCard[];
    backlog: SixHiQueueCard[];
    completed: SixHiQueueCard[];
    rejected: SixHiQueueCard[];
    queueNextCursor?: string | null;
  }> {
    /** Operational view date — drives backlog comparison only (see below). */
    const operationalViewDate = prodDate;
    const operationalViewDateKey = postgresDateOnly(operationalViewDate);
    const incomplete = [...SixHiService.INCOMPLETE_ORDER_STATUSES];

    const earlierSameDayShifts = earlierShiftCodesOnSameDay(shiftCode);
    /**
     * Operator-level backlog (intentional vs plant-level):
     * - Includes prior calendar days (plan_date < operational view date), AND
     * - Same-day earlier shifts (e.g. viewing Shift B still shows Shift A plans as backlog).
     * This is the operational floor view: work that should already have been done by now
     * in the shift sequence. Plant Head KPI/drawer use calendar-day-only
     * (plan_date < today) for a strategic plant-wide backlog — see doc/BACKLOG_DEFINITIONS.md.
     * Do not change this same-day-earlier-shift rule without updating that doc.
     *
     * Planning comparison only — PPC plan_date vs the operator's operational view date.
     * Does not influence shift detection or production attribution.
     * Bind YYYY-MM-DD strings (not IST-midnight Date) so UTC DB hosts don't off-by-one.
     */
    const backlogPlanFilter = (eb: any) => {
      const priorDay = eb('pb.plan_date', '<', operationalViewDateKey);
      if (earlierSameDayShifts.length === 0) return priorDay;
      return eb.or([
        priorDay,
        eb.and([
          eb('pb.plan_date', '=', operationalViewDateKey),
          eb('pb.shift_code', 'in', earlierSameDayShifts),
        ]),
      ]);
    };
    const incompleteFilter = (eb: any) =>
      eb.or([
        eb('o.status', 'is', null),
        eb('o.status', 'in', incomplete),
      ]);

    // Operational assigned queue — machine sequence only (not planned date).
    let assignedQ = db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .select([...SixHiService.QUEUE_BATCH_COLS])
      .where('pb.machine_code', '=', machineCode)
      .where('pb.sub_process', '=', subProcess)
      .where('pb.machine_allocated', '=', true)
      .where(incompleteFilter)
      .orderBy('pb.queue_seq', 'asc')
      .orderBy('pb.batch_number', 'asc');

    const pageLimit = paging?.limit != null && paging.limit > 0
      ? Math.min(200, Math.max(1, Math.floor(paging.limit)))
      : undefined;
    if (pageLimit && paging?.cursor) {
      const sep = paging.cursor.indexOf(':');
      const curSeq = sep >= 0 ? Number(paging.cursor.slice(0, sep)) : NaN;
      const curBn = sep >= 0 ? paging.cursor.slice(sep + 1) : paging.cursor;
      if (Number.isFinite(curSeq) && curBn) {
        assignedQ = assignedQ.where((eb) => eb.or([
          eb('pb.queue_seq', '>', curSeq),
          eb.and([eb('pb.queue_seq', '=', curSeq), eb('pb.batch_number', '>', curBn)]),
        ]));
      }
    }
    if (pageLimit) assignedQ = assignedQ.limit(pageLimit + 1);

    const batchRowsRaw = await assignedQ.execute();
    let queueNextCursor: string | null | undefined = pageLimit ? null : undefined;
    let batches = batchRowsRaw;
    if (pageLimit && batchRowsRaw.length > pageLimit) {
      batches = batchRowsRaw.slice(0, pageLimit);
      const last = batches[batches.length - 1] as { queue_seq?: number | null; batch_number: string };
      queueNextCursor = `${Number(last.queue_seq ?? 0)}:${last.batch_number}`;
    }

    // Cursor pages only need the assigned slice — skip other buckets on load-more.
    if (pageLimit && paging?.cursor) {
      const cardCtx = await this.prefetchQueueCardContext(batches, subProcess);
      const cards: SixHiQueueCard[] = [];
      let pos = 0;
      for (const b of batches) {
        pos++;
        cards.push(this.mapQueueCard(b, subProcess, pos, cardCtx));
      }
      return {
        prodDate: operationalViewDate,
        shiftCode,
        machineCode,
        queue: cards,
        pendingAllocation: [],
        backlog: [],
        completed: [],
        rejected: [],
        queueNextCursor,
      };
    }

    // Operational pending pool — unallocated, excluding PPC backlog bucket.
    const pendingBatches = await db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .select([...SixHiService.QUEUE_BATCH_COLS])
      .where('pb.sub_process', '=', subProcess)
      .where('pb.machine_allocated', '=', false)
      .where(incompleteFilter)
      .where((eb) => eb.not(backlogPlanFilter(eb)))
      .orderBy('pb.queue_seq', 'asc')
      .orderBy('pb.batch_number', 'asc')
      .execute();

    // Planning backlog visibility — compare PPC plan_date to operational view (not shift input).
    const backlogBatches = await db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .select([...SixHiService.QUEUE_BATCH_COLS])
      .where('pb.sub_process', '=', subProcess)
      .where('pb.machine_allocated', '=', false)
      .where(backlogPlanFilter)
      .where(incompleteFilter)
      .orderBy('pb.plan_date', 'asc')
      .orderBy('pb.queue_seq', 'asc')
      .orderBy('pb.batch_number', 'asc')
      .execute();

    const terminalBatches = await this.fetchTerminalBatches(
      subProcess,
      machineCode,
      operationalViewDate,
      shiftCode,
      shiftLogId,
    );

    const allBatchRows = [
      ...batches,
      ...pendingBatches,
      ...backlogBatches,
      ...terminalBatches.map((row) => row.batch as typeof SixHiService.queueBatchRowShape),
    ];
    const cardCtx = await this.prefetchQueueCardContext(allBatchRows, subProcess);

    const cards: SixHiQueueCard[] = [];
    let pos = 0;
    for (const b of batches) {
      pos++;
      cards.push(this.mapQueueCard(b, subProcess, pos, cardCtx));
    }

    const pendingAllocation: SixHiQueueCard[] = [];
    let pendingPos = 0;
    for (const b of pendingBatches) {
      pendingPos++;
      pendingAllocation.push(this.mapQueueCard(b, subProcess, pendingPos, cardCtx));
    }

    const backlog: SixHiQueueCard[] = [];
    let backlogPos = 0;
    for (const b of backlogBatches) {
      backlogPos++;
      backlog.push(this.mapQueueCard(b, subProcess, backlogPos, cardCtx, { isBacklog: true }));
    }

    const completed: SixHiQueueCard[] = [];
    const rejected: SixHiQueueCard[] = [];
    let completedPos = 0;
    let rejectedPos = 0;
    for (const row of terminalBatches) {
      const card = this.mapQueueCard(
        row.batch as typeof SixHiService.queueBatchRowShape,
        subProcess,
        row.status === 'COMPLETED' ? ++completedPos : ++rejectedPos,
        cardCtx,
      );
      if (row.status === 'COMPLETED') completed.push(card);
      else rejected.push(card);
    }

    return {
      prodDate: operationalViewDate,
      shiftCode,
      machineCode,
      queue: cards,
      pendingAllocation,
      backlog,
      completed,
      rejected,
      ...(pageLimit ? { queueNextCursor } : {}),
    };
  }

  /** Completed = current shift-log only; Hold (REJECTED) = machine-wide until completed. */
  private static async fetchTerminalBatches(
    subProcess: SixHiSubProcess,
    machineCode: string,
    prodDate: string,
    shiftCode: string,
    shiftLogId?: string,
  ): Promise<Array<{ status: 'COMPLETED' | 'REJECTED'; batch: Record<string, unknown> }>> {
    const base = () =>
      db
        .selectFrom('planning.ppc_batch as pb')
        .innerJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
        .select([...SixHiService.QUEUE_BATCH_COLS])
        .select(['o.status'])
        .where('pb.machine_code', '=', machineCode)
        .where('pb.sub_process', '=', subProcess)
        .where('pb.machine_allocated', '=', true);

    const logIds = shiftLogId
      ? await this.expandSiblingShiftLogIds(shiftLogId)
      : await this.resolveShiftLogIdsForPlan(prodDate, shiftCode);

    const completedRows =
      logIds.length === 0
        ? []
        : await base()
            .where('o.status', '=', 'COMPLETED')
            .where('o.shift_log_id', 'in', logIds)
            .orderBy('o.updated_at', 'desc')
            .orderBy('pb.batch_number', 'asc')
            .execute();

    if (logIds.length === 0) {
      console.warn(
        `[SixHi] fetchTerminalBatches: no shift_log for ${prodDate}/${shiftCode} — completed list empty`,
      );
    }

    // Hold queue: recent REJECTED for this mill/sub-process (capped).
    const rejectedRows = await base()
      .where('o.status', '=', 'REJECTED')
      .orderBy('o.updated_at', 'desc')
      .orderBy('pb.batch_number', 'asc')
      .limit(SIXHI_HOLD_MAX_ROWS)
      .execute();

    return [
      ...completedRows.map((row) => ({
        status: 'COMPLETED' as const,
        batch: row,
      })),
      ...rejectedRows.map((row) => ({
        status: 'REJECTED' as const,
        batch: row,
      })),
    ];
  }

  static async allocateMachine(
    batchNumber: string,
    machineCode: string,
    userId: number,
    options?: { reason?: string; transferType?: 'SINGLE' | 'BULK'; allowReassign?: boolean },
  ): Promise<SixHiOrderDetail> {
    const batch = await db.selectFrom('planning.ppc_batch')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch) throw new Error(`Batch not found: ${batchNumber}`);

    const subProcess = batch.sub_process as SixHiSubProcess;
    const machine = await MachineRegistryService.assertMachineForSubProcess(subProcess, machineCode);

    const sourceMachine = batch.machine_code;
    // PERF-E3: same target = idempotent; other machine = 409 unless MH transfer.
    const claim = assertMachineClaimOrIdempotent(
      { batchNumber, machine_code: sourceMachine, machine_allocated: batch.machine_allocated },
      machine,
      options?.allowReassign === true,
    );
    if (claim === 'idempotent') {
      return this.getOrder(batchNumber, userId);
    }

    const order = await db.selectFrom('txn.crm_order')
      .select(['order_id', 'status'])
      .where('batch_id', '=', batch.batch_id)
      .executeTakeFirst();
    if (order && !['PENDING', 'PREPARING'].includes(order.status)) {
      throw new Error('Cannot change machine allocation while order is in production');
    }

    await this.ensureOrder(batchNumber, userId);
    await ensureOrderMachineTransferTable();

    await db.transaction().execute(async (trx) => {
      const maxSeq = await trx.selectFrom('planning.ppc_batch')
        .select(trx.fn.max('queue_seq').as('max_seq'))
        .where('machine_code', '=', machine)
        .where('sub_process', '=', subProcess)
        .where('machine_allocated', '=', true)
        .executeTakeFirst();
      const queueSeq = (Number(maxSeq?.max_seq) || 0) + 1;

      // CAS: unallocated or already on target — lost race → 409 with current.
      let upd = trx.updateTable('planning.ppc_batch')
        .set({
          machine_code: machine,
          machine_allocated: true,
          queue_seq: queueSeq,
        })
        .where('batch_id', '=', batch.batch_id);
      if (!options?.allowReassign) {
        upd = upd.where((eb) => eb.or([
          eb('machine_allocated', '=', false),
          eb('machine_code', '=', machine),
        ]));
      }
      const result = await upd.executeTakeFirst();
      if (!options?.allowReassign && Number(result.numUpdatedRows ?? 0) === 0) {
        const cur = await trx.selectFrom('planning.ppc_batch')
          .select(['batch_number', 'machine_code', 'machine_allocated'])
          .where('batch_id', '=', batch.batch_id)
          .executeTakeFirst();
        if (cur?.machine_allocated && cur.machine_code === machine) {
          return; // concurrent idempotent claim
        }
        throwVersionConflict({
          batchNumber: cur?.batch_number ?? batchNumber,
          machineCode: cur?.machine_code ?? null,
          machineAllocated: cur?.machine_allocated ?? true,
        });
      }

      const journeyStep = await trx.selectFrom('planning.order_journey_step as ojs')
        .innerJoin('planning.order_journey as oj', 'oj.journey_id', 'ojs.journey_id')
        .select(['ojs.step_id'])
        .where('oj.coil_no', '=', batch.coil_no)
        .where('oj.status', '=', 'ACTIVE')
        .where('ojs.queue_batch_id', '=', batch.batch_id)
        .executeTakeFirst();

      if (journeyStep) {
        await trx.updateTable('planning.order_journey_step')
          .set({ machine_code: machine })
          .where('step_id', '=', journeyStep.step_id)
          .execute();
      }

      await trx.updateTable('txn.crm_order')
        .set({ status: 'PREPARING' })
        .where('batch_id', '=', batch.batch_id)
        .where('status', '=', 'PENDING')
        .execute();

      await recordOrderMachineTransfer({
        orderId: order?.order_id ? Number(order.order_id) : null,
        batchNumber,
        sourceMachine,
        destinationMachine: machine,
        subProcess,
        assignedBy: userId,
        reason: options?.reason,
        transferType: options?.transferType ?? 'SINGLE',
      }, trx);
    });

    MachineRegistryService.invalidateCache();
    return this.getOrder(batchNumber, userId);
  }

  static async transferMachines(
    batchNumbers: string[],
    targetMachine: string,
    userId: number,
    roles: string[],
    reason?: string,
    transferType: 'SINGLE' | 'BULK' = 'SINGLE',
  ): Promise<{ batchNumber: string; ok: boolean; error?: string }[]> {
    const resolvedTarget = await MachineRegistryService.resolveMachineCode(targetMachine);
    if (!resolvedTarget) throw new Error(`Unknown or inactive machine: ${targetMachine}`);

    const isElevated = roles.includes('ADMIN') || roles.includes('PLANT_HEAD');
    if (!isElevated) {
      const { MachineAccessService } = await import('./MachineAccessService');
      const allowed = await MachineAccessService.getForUser(userId);
      if (!allowed.includes(resolvedTarget)) {
        throw new Error(`Not authorized to assign orders to ${resolvedTarget}`);
      }
    }

    const results: { batchNumber: string; ok: boolean; error?: string }[] = [];
    for (const batchNumber of batchNumbers) {
      try {
        await this.allocateMachine(batchNumber, resolvedTarget, userId, {
          reason,
          transferType,
          allowReassign: true,
        });
        results.push({ batchNumber, ok: true });
      } catch (e: unknown) {
        results.push({
          batchNumber,
          ok: false,
          error: e instanceof Error ? e.message : 'Transfer failed',
        });
      }
    }
    return results;
  }

  static async getOrderAssignmentBoard() {
    const nonAssignable = [...SixHiService.NON_ASSIGNABLE_ORDER_STATUSES];

    const batches = await db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .selectAll('pb')
      .where('pb.machine_allocated', '=', false)
      .where((eb) => eb.or([
        eb('o.status', 'is', null),
        eb('o.status', 'not in', nonAssignable),
      ]))
      .orderBy('pb.plan_date', 'asc')
      .orderBy('pb.shift_code', 'asc')
      .orderBy('pb.queue_seq', 'asc')
      .orderBy('pb.batch_number', 'asc')
      .execute();

    const orders = [];
    for (const b of batches) {
      const subProcess = b.sub_process as SixHiSubProcess;
      const crmOrder = await db.selectFrom('txn.crm_order')
        .select(['status'])
        .where('batch_id', '=', b.batch_id)
        .executeTakeFirst();
      const status = (crmOrder?.status as string) ?? 'PENDING';
      if (SixHiService.NON_ASSIGNABLE_ORDER_STATUSES.has(status)) continue;

      orders.push({
        batchNumber: b.batch_number,
        planDate: this.formatPlanDate(b.plan_date),
        shiftCode: b.shift_code,
        customer: b.customer_name,
        product: b.grade_code,
        quantityMt: Number(b.ppc_weight_mt),
        currentMachine: null,
        suggestedMachine: b.machine_code ?? undefined,
        subProcess,
        status,
        machineAllocated: false,
      });
    }

    const crmMills = await MachineRegistryService.getCrmMills();
    const activeStatuses = [...SixHiService.INCOMPLETE_ORDER_STATUSES];
    const machines = await Promise.all(
      crmMills.map(async (entry) => {
        const code = entry.machineCode;
        const queueCount = await db.selectFrom('planning.ppc_batch as pb')
          .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
          .select(db.fn.countAll<number>().as('cnt'))
          .where('pb.machine_code', '=', code)
          .where('pb.machine_allocated', '=', true)
          .where((eb) => eb.or([
            eb('o.status', 'is', null),
            eb('o.status', 'in', activeStatuses),
          ]))
          .executeTakeFirst();

        const active = await db.selectFrom('txn.crm_order as o')
          .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
          .select(['pb.batch_number'])
          .where('pb.machine_code', '=', code)
          .where('o.status', '=', 'IN_PROGRESS')
          .executeTakeFirst();

        return {
          code,
          name: entry.name,
          rolling: entry.rolling,
          skinPass: entry.skinPass,
          queueCount: Number(queueCount?.cnt ?? 0),
          activeBatch: active?.batch_number ?? null,
        };
      }),
    );

    const recentTransfers = await loadRecentOrderMachineTransfersGlobal();

    return {
      orders,
      machines,
      recentTransfers,
    };
  }

  static async ensureOrder(batchNumber: string, userId: number): Promise<string> {
    const batch = await db.selectFrom('planning.ppc_batch')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch) throw new Error(`Batch not found: ${batchNumber}`);

    const existing = await db.selectFrom('txn.crm_order')
      .select('order_id')
      .where('batch_id', '=', batch.batch_id)
      .executeTakeFirst();
    if (existing) return String(existing.order_id);

    const { ShiftDetectionService } = await import('./ShiftDetectionService');
    const detected = await ShiftDetectionService.getCurrentShift({
      userId,
      machineCode: batch.machine_code,
    });
    const prodDate = postgresDateOnly(detected.prodDate);
    const activeShift = detected.shiftCode.toUpperCase();
    const shiftLogId = await this.ensureActiveShiftLog(userId, prodDate, activeShift);

    const inputThk = Number(batch.input_thk_mm ?? batch.ppc_thk_mm);

    await db.insertInto('coil.coil')
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

    const order = await db.insertInto('txn.crm_order')
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
        sub_process: batch.sub_process,
        status: 'PENDING',
        logged_in_user_id: userId,
        production_day: prodDate,
        shift_code: activeShift,
        prod_date: prodDate,
      } as any)
      .returning('order_id')
      .executeTakeFirstOrThrow();

    if (batch.sub_process === 'ROLLING' && ROLLING_MILLS.includes(batch.machine_code as CrmMillCode)) {
      await db.insertInto('txn.crm_rolling')
        .values({
          order_id: order.order_id,
          destination: batch.destination ?? 'ANNEALING',
          roll_finish: batch.roll_finish ?? 'MATT',
          rerolling: batch.ppc_reroll_flag ?? false,
          associate_rw: batch.destination === 'REWINDING' ? 'R/W' : null,
          shift_code: activeShift,
          prod_date: prodDate,
        } as any)
        .execute();
    } else {
      await db.insertInto('txn.crm_skinpass').values({ order_id: order.order_id }).execute();
    }

    return String(order.order_id);
  }

  static async getOrder(batchNumber: string, userId: number): Promise<SixHiOrderDetail> {
    await this.ensureOrder(batchNumber, userId);
    const order = await db.selectFrom('txn.crm_order')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirstOrThrow();

    const ppcBatch = await db.selectFrom('planning.ppc_batch')
      .selectAll()
      .where('batch_id', '=', order.batch_id)
      .executeTakeFirst();

    const rollChanges = await db.selectFrom('txn.crm_roll_change as rc')
      .leftJoin('security.app_user as u', 'rc.operator_id', 'u.user_id')
      .select([
        'rc.change_id', 'rc.roll_position', 'rc.prev_roll_no', 'rc.prev_roll_code',
        'rc.new_roll_no', 'rc.new_roll_code', 'rc.reason_text', 'rc.changed_at', 'u.full_name',
      ])
      .where('rc.order_id', '=', order.order_id)
      .orderBy('rc.changed_at', 'desc')
      .execute();

    const remarks = await db.selectFrom('txn.order_remark as r')
      .leftJoin('security.app_user as u', 'r.operator_id', 'u.user_id')
      .select(['r.remark_id', 'r.text', 'r.created_at', 'r.defect_codes', 'u.full_name'])
      .where('r.order_id', '=', order.order_id)
      .orderBy('r.created_at', 'asc')
      .execute();

    const stoppages = await db.selectFrom('txn.stoppage as os')
      .innerJoin('master.stoppage_category as sc', 'os.category_code', 'sc.category_code')
      .select([
        'os.stoppage_id', 'os.category_code', 'sc.label', 'os.breakdown_code',
        'os.start_at', 'os.end_at', 'os.duration_min', 'os.remarks',
      ])
      .where('os.order_id', '=', order.order_id)
      .orderBy('os.start_at', 'desc')
      .execute();

    const activeStoppage = stoppages.find((s) => !s.end_at);

    let resolvedStatus = order.status;
    if (order.status === 'STOPPAGE' && !activeStoppage) {
      resolvedStatus = order.prod_start_at ? 'IN_PROGRESS' : 'PENDING';
      // Phase 4.3: heal only when still STOPPAGE — avoid fighting concurrent UI writes.
      await db.updateTable('txn.crm_order')
        .set({ status: resolvedStatus, updated_at: new Date() })
        .where('order_id', '=', order.order_id)
        .where('status', '=', 'STOPPAGE')
        .execute();
    }

    let rolling: SixHiRollingData | undefined;
    let skinPass: SixHiSkinPassData | undefined;

    if (order.sub_process === 'ROLLING') {
      const r = await db.selectFrom('txn.crm_rolling').selectAll().where('order_id', '=', order.order_id).executeTakeFirst();
      const passes = await db.selectFrom('txn.crm_rolling_pass')
        .selectAll()
        .where('order_id', '=', order.order_id)
        .orderBy('pass_no', 'asc')
        .execute();
      if (r) {
        rolling = {
          actualWeightMt: r.actual_weight_mt ? Number(r.actual_weight_mt) : undefined,
          destination: mapDestination(r.destination),
          destinationOverride: r.destination_override ?? false,
          associateRw: r.associate_rw ?? undefined,
          etr: r.etr ? Number(r.etr) : undefined,
          dtr: r.dtr ? Number(r.dtr) : undefined,
          passes: passes.map((p) => ({ passNo: p.pass_no, thicknessMm: Number(p.thickness_mm) })),
          totalPasses: r.total_passes ?? passes.length,
          finalThkMm: r.final_thk_mm ? Number(r.final_thk_mm) : undefined,
          rollInNo: r.roll_in_no ?? undefined,
          rollInCode: r.roll_in_code ?? undefined,
          rollOutNo: r.roll_out_no ?? undefined,
          rollOutCode: r.roll_out_code ?? undefined,
          ...mapActualWeightOcrFields(r),
        };
      }
    } else {
      const s = await db.selectFrom('txn.crm_skinpass').selectAll().where('order_id', '=', order.order_id).executeTakeFirst();
      if (s) {
        skinPass = {
          actualWeightMt: s.actual_weight_mt ? Number(s.actual_weight_mt) : undefined,
          outputThkMm: s.output_thk_mm ? Number(s.output_thk_mm) : undefined,
          annHard: s.ann_hard ? Number(s.ann_hard) : undefined,
          rwTension1: s.rw_tension_1 ? Number(s.rw_tension_1) : undefined,
          rwTension2: s.rw_tension_2 ? Number(s.rw_tension_2) : undefined,
          operatingMode: (s.operating_mode as 'LOAD' | 'STRETCH') ?? undefined,
          loadMinT: s.load_min_t ? Number(s.load_min_t) : undefined,
          loadMaxT: s.load_max_t ? Number(s.load_max_t) : undefined,
          stretchPct: s.stretch_pct ? Number(s.stretch_pct) : undefined,
          ...mapActualWeightOcrFields(s),
        };
      }
    }

    const passPlans = ppcBatch
      ? await db.selectFrom('planning.ppc_rolling_pass_plan')
          .selectAll()
          .where('batch_id', '=', ppcBatch.batch_id)
          .orderBy('pass_no', 'asc')
          .execute()
      : [];

    const inputThk = order.sub_process === 'SKIN_PASS'
      ? Number(order.input_thk_mm ?? 0)
      : Number(order.input_thk_mm ?? order.ppc_thk_mm);
    const targetThk = Number(order.ppc_thk_mm);
    const finishThk = ppcBatch?.finish_thk_mm != null ? Number(ppcBatch.finish_thk_mm) : undefined;

    const rejection = resolvedStatus === 'REJECTED'
      ? await loadOrderRejection(order.order_id)
      : undefined;

    let ocrMinConfidence: number | undefined;
    if (ppcBatch?.machine_code) {
      try {
        const machine = await db
          .selectFrom('master.machine')
          .select('ocr_min_confidence')
          .where('machine_code', '=', ppcBatch.machine_code)
          .executeTakeFirst();
        if (machine?.ocr_min_confidence != null) {
          ocrMinConfidence = Number(machine.ocr_min_confidence);
        }
      } catch {
        // ponytail: column added by 1940000000000_weight_ocr_capture — ignore until migrated
        ocrMinConfidence = undefined;
      }
    }

    let prodDurationMin: number | undefined = order.prod_duration_min ?? undefined;
    if (
      (prodDurationMin == null || prodDurationMin <= 0)
      && order.prod_start_at
      && order.prod_end_at
      && (resolvedStatus === 'COMPLETED' || resolvedStatus === 'REJECTED')
    ) {
      let totalStoppageMin = 0;
      for (const s of stoppages) {
        totalStoppageMin += resolveStoppageMinutes(s.start_at, s.end_at, s.duration_min);
      }
      const wallMin = Math.round(
        (order.prod_end_at.getTime() - order.prod_start_at.getTime()) / 60000,
      );
      const computed = Math.max(0, wallMin - totalStoppageMin);
      if (computed > 0) prodDurationMin = computed;
    }

    return {
      orderId: String(order.order_id),
      batchNumber: order.batch_number,
      motherCoil: order.coil_no,
      slitId: order.slit_id ?? undefined,
      customer: order.customer_name,
      grade: order.grade_code,
      widthMm: Number(order.width_mm),
      inputThkMm: inputThk,
      targetThkMm: targetThk,
      finishThkMm: finishThk,
      minThkTolMm: ppcBatch?.min_thk_tol_mm != null ? Number(ppcBatch.min_thk_tol_mm) : undefined,
      maxThkTolMm: ppcBatch?.max_thk_tol_mm != null ? Number(ppcBatch.max_thk_tol_mm) : undefined,
      raMaxUm: ppcBatch?.sp_ra_max_um != null ? Number(ppcBatch.sp_ra_max_um) : undefined,
      raMinUm: ppcBatch?.sp_ra_min_um != null ? Number(ppcBatch.sp_ra_min_um) : undefined,
      machineCode: ppcBatch?.machine_code,
      ocrMinConfidence,
      machineAllocated: ppcBatch?.machine_allocated ?? true,
      rollingPassNo: ppcBatch?.active_rolling_pass_no ? Number(ppcBatch.active_rolling_pass_no) : undefined,
      rollingPassPlans: passPlans.length > 0
        ? passPlans.map((p) => ({
            passNo: p.pass_no,
            targetThkMm: p.target_thk_mm != null ? Number(p.target_thk_mm) : undefined,
            rollFinish: p.roll_finish ? mapRollFinish(p.roll_finish) : undefined,
          }))
        : undefined,
      ppcThkMm: targetThk,
      ppcWeightMt: Number(order.ppc_weight_mt),
      subProcess: order.sub_process as SixHiSubProcess,
      status: resolvedStatus as SixHiOrderDetail['status'],
      ppcDestination: ppcBatch?.destination ? mapDestination(ppcBatch.destination) : undefined,
      ppcRollFinish: ppcBatch?.roll_finish ? mapRollFinish(ppcBatch.roll_finish) : undefined,
      ppcRerollFlag: ppcBatch?.ppc_reroll_flag ?? false,
      prodStartAt: order.prod_start_at?.toISOString(),
      prodEndAt: order.prod_end_at?.toISOString(),
      prodDurationMin,
      rolling,
      skinPass,
      rollChanges: rollChanges.map((rc) => ({
        id: String(rc.change_id),
        rollPosition: rc.roll_position as 'IN' | 'OUT',
        prevRollNo: rc.prev_roll_no ?? undefined,
        prevRollCode: rc.prev_roll_code ?? undefined,
        newRollNo: rc.new_roll_no,
        newRollCode: rc.new_roll_code ?? undefined,
        reasonText: rc.reason_text ?? undefined,
        changedAt: rc.changed_at.toISOString(),
        operatorName: rc.full_name ?? undefined,
      })),
      remarks: remarks.map((r) => ({
        id: String(r.remark_id),
        text: r.text,
        createdAt: r.created_at.toISOString(),
        operatorName: r.full_name ?? undefined,
        defects: r.defect_codes
          ? (typeof r.defect_codes === 'string' ? JSON.parse(r.defect_codes) : r.defect_codes)
          : undefined,
      })),
      stoppages: stoppages.map((s) => ({
        id: String(s.stoppage_id),
        categoryCode: s.category_code,
        categoryLabel: s.label,
        breakdownCode: s.breakdown_code ?? undefined,
        startAt: s.start_at.toISOString(),
        endAt: s.end_at?.toISOString(),
        durationMin: s.duration_min ?? undefined,
        remarks: s.remarks ?? undefined,
      })),
      activeStoppage: activeStoppage ? {
        id: String(activeStoppage.stoppage_id),
        categoryCode: activeStoppage.category_code,
        categoryLabel: activeStoppage.label,
        breakdownCode: activeStoppage.breakdown_code ?? undefined,
        startAt: activeStoppage.start_at.toISOString(),
        remarks: activeStoppage.remarks ?? undefined,
      } : undefined,
      rejection,
    };
  }

  static async findActiveMachineOrder(
    machineCode: string,
  ): Promise<{ batchNumber: string; status: string; subProcess: SixHiSubProcess } | null> {
    const active = await db.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select(['o.batch_number', 'o.status', 'o.sub_process'])
      .where('o.status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .where('pb.machine_code', '=', machineCode)
      .where('pb.machine_allocated', '=', true)
      .orderBy('o.updated_at', 'desc')
      .executeTakeFirst();
    if (!active) return null;
    return {
      batchNumber: active.batch_number,
      status: active.status,
      subProcess: active.sub_process as SixHiSubProcess,
    };
  }

  static async startProduction(batchNumber: string, userId: number) {
    const batch = await db.selectFrom('planning.ppc_batch')
      .select(['machine_code', 'machine_allocated', 'shift_code', 'sub_process'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch?.machine_allocated) {
      throw new Error('Assign a production machine before starting');
    }
    const machineCode = batch.machine_code;
    if (!machineCode) throw new Error('Order has no machine assigned');
    assertMachineForSubProcess(
      batch.sub_process === 'SKIN_PASS' ? 'SKIN_PASS' : 'ROLLING',
      machineCode,
    );
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);

    const active = await this.findActiveMachineOrder(machineCode);
    if (active && active.batchNumber !== batchNumber) {
      throw new Error(`ACTIVE_ORDER_CONFLICT:${active.batchNumber}`);
    }
    const { ManualRerollService } = await import('./ManualRerollService');
    await ManualRerollService.assertNoActiveReroll(machineCode);

    const orderRow = await db.selectFrom('txn.crm_order')
      .select(['order_id', 'status', 'coil_no', 'prod_start_at'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!orderRow) {
      await this.ensureOrder(batchNumber, userId);
    }
    const orderId = orderRow?.order_id ?? await this.ensureOrder(batchNumber, userId);
    const status = orderRow?.status ?? 'PENDING';

    if (status === 'IN_PROGRESS') {
      return this.getOrder(batchNumber, userId);
    }
    if (status === 'STOPPAGE') {
      await this.assertNoOpenStoppage(orderId);

      // Combined group: resume every STOPPAGE sibling together (same session, no new prod_start_at).
      const groupIdRow = await db.selectFrom('txn.crm_order')
        .select('combined_group_id')
        .where('order_id', '=', orderId)
        .executeTakeFirst();
      let resumeTargets: Array<{ order_id: string | number; batch_number: string }> = [
        { order_id: orderId, batch_number: batchNumber },
      ];
      if (groupIdRow?.combined_group_id) {
        const siblings = await this.loadCombinedGroupMembers(
          String(groupIdRow.combined_group_id),
          ['STOPPAGE', 'IN_PROGRESS'],
        );
        for (const sibling of siblings) {
          if (sibling.status === 'STOPPAGE') {
            await this.assertNoOpenStoppage(sibling.order_id);
          }
        }
        resumeTargets = siblings.map((s) => ({
          order_id: s.order_id,
          batch_number: String(s.batch_number),
        }));
      }

      await db.transaction().execute(async (trx) => {
        for (const target of resumeTargets) {
          await trx.updateTable('txn.crm_order')
            .set({ status: 'IN_PROGRESS', updated_at: new Date() })
            .where('order_id', '=', target.order_id as any)
            .where('status', '=', 'STOPPAGE')
            .execute();
        }
      });

      for (const target of resumeTargets) {
        await this.reattributeOrderToActiveShift(target.order_id, userId, machineCode);
      }

      const orderShift = await db.selectFrom('txn.crm_order')
        .select('shift_code')
        .where('order_id', '=', orderId)
        .executeTakeFirst();
      const sessionShift = orderShift?.shift_code
        ?? (await ShiftDetectionService.getCurrentShift({
          userId,
          machineCode,
          requireCallerSession: true,
        })).shiftCode;
      MachineStateEventService.recordEvent(machineCode, 'RUNNING_STARTED', {
        orderId,
        batchNumber,
        operatorId: userId,
        shiftCode: sessionShift,
        meta: resumeTargets.length > 1
          ? { combinedResumeBatchNumbers: resumeTargets.map((t) => t.batch_number) }
          : undefined,
      }).catch((err) => console.error('[MachineStateEvent] RUNNING_STARTED failed:', err));
      return this.getOrder(batchNumber, userId);
    }
    if (status !== 'PENDING' && status !== 'PREPARING') {
      throw new Error('Only pending or preparing orders can be started');
    }

    await db.updateTable('txn.crm_order')
      .set({ 
        status: 'IN_PROGRESS', 
        prod_start_at: orderRow?.prod_start_at ?? new Date(), 
        updated_at: new Date() 
      })
      .where('order_id', '=', orderId)
      .execute();
    const coilNo = orderRow?.coil_no ?? (await db.selectFrom('txn.crm_order').select('coil_no').where('order_id', '=', orderId).executeTakeFirstOrThrow()).coil_no;
    await db.updateTable('coil.coil')
      .set({ status: 'IN_PROCESS' })
      .where('coil_no', '=', coilNo)
      .execute();

    // Production has begun: attribute the order to the operator's actual active shift.
    // Backlog orders planned for a previous shift are moved to today's shift here.
    await this.reattributeOrderToActiveShift(orderId, userId, machineCode);

    const attributed = await db.selectFrom('txn.crm_order')
      .select('shift_code')
      .where('order_id', '=', orderId)
      .executeTakeFirst();

    // Persist machine state event with post-reattribute / session shift (fix 4.4).
    MachineStateEventService.recordEvent(machineCode, 'RUNNING_STARTED', {
      orderId,
      batchNumber,
      operatorId: userId,
      shiftCode: attributed?.shift_code ?? batch.shift_code,
    }).catch((err) => console.error('[MachineStateEvent] RUNNING_STARTED failed:', err));

    return this.getOrder(batchNumber, userId);
  }

  static async startCombinedProduction(
    batchNumbers: string[],
    userId: number,
    opts?: { mode?: 'prepare' | 'start' },
  ): Promise<SixHiOrderDetail[]> {
    const mode = opts?.mode === 'prepare' ? 'prepare' : 'start';
    const uniqueBatchNumbers = Array.from(new Set(batchNumbers.map((batch) => batch.trim()).filter(Boolean)));
    if (uniqueBatchNumbers.length === 0) {
      throw new Error('At least one order is required');
    }

    const batches = await db.selectFrom('planning.ppc_batch')
      .select([
        'batch_number',
        'coil_no',
        'slit_id',
        'roll_finish',
        'ppc_thk_mm',
        'input_thk_mm',
        'finish_thk_mm',
        'machine_code',
        'machine_allocated',
        'sub_process',
        'shift_code',
      ])
      .where('batch_number', 'in', uniqueBatchNumbers)
      .execute();

    if (batches.length !== uniqueBatchNumbers.length) {
      throw new Error('One or more selected orders were not found');
    }

    const first = batches[0];
    const normalized = (value: string | null | undefined) => value?.trim() || '';
    const baseKey = [first.coil_no, normalized(first.slit_id), finishGroup(first.roll_finish)].join('|');

    for (const batch of batches) {
      if (!batch.machine_allocated) {
        throw new Error('Assign a production machine before starting');
      }
      if (batch.machine_code !== first.machine_code) {
        throw new Error('Combined production orders must be assigned to the same machine');
      }
      if (batch.sub_process !== first.sub_process) {
        throw new Error('Combined production orders must use the same subprocess');
      }
      const key = [batch.coil_no, normalized(batch.slit_id), finishGroup(batch.roll_finish)].join('|');
      if (key !== baseKey) {
        throw new Error('Selected orders must share Mother Coil, Slit ID, and Finish surface');
      }
    }

    const machineCode = first.machine_code;
    if (!machineCode) throw new Error('Order has no machine assigned');
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);

    // Ensure every selected batch has an order row and collect current statuses.
    type StartRow = {
      batchNumber: string;
      orderId: string | number;
      status: string;
      coilNo: string;
      prodStartAt: Date | null;
      combinedGroupId: string | null;
    };
    const startRows: StartRow[] = [];
    for (const batchNumber of uniqueBatchNumbers) {
      const orderRow = await db.selectFrom('txn.crm_order')
        .select(['order_id', 'status', 'coil_no', 'prod_start_at', 'combined_group_id'])
        .where('batch_number', '=', batchNumber)
        .executeTakeFirst();
      const orderId = orderRow?.order_id ?? await this.ensureOrder(batchNumber, userId);
      const refreshed = orderRow ?? await db.selectFrom('txn.crm_order')
        .select(['order_id', 'status', 'coil_no', 'prod_start_at', 'combined_group_id'])
        .where('order_id', '=', orderId)
        .executeTakeFirstOrThrow();
      startRows.push({
        batchNumber,
        orderId: refreshed.order_id,
        status: refreshed.status,
        coilNo: refreshed.coil_no,
        prodStartAt: refreshed.prod_start_at ?? null,
        combinedGroupId: refreshed.combined_group_id ? String(refreshed.combined_group_id) : null,
      });
    }

    const existingGroupId = startRows.map((r) => r.combinedGroupId).find(Boolean) ?? null;
    const groupId = uniqueBatchNumbers.length > 1
      ? (existingGroupId ?? randomUUID())
      : null;
    const stamp = new Date();

    // Hub combine: stamp group + PREPARING only — Start on the rail actually runs production.
    if (mode === 'prepare') {
      for (const row of startRows) {
        if (row.status !== 'PENDING' && row.status !== 'PREPARING') {
          throw new Error('Only pending or preparing orders can be combined into preparing');
        }
      }
      await db.transaction().execute(async (trx) => {
        for (const row of startRows) {
          await trx.updateTable('txn.crm_order')
            .set({
              status: 'PREPARING',
              updated_at: stamp,
              ...(groupId ? { combined_group_id: groupId } : {}),
            })
            .where('order_id', '=', row.orderId as any)
            .execute();
        }
        if (groupId) {
          await trx.updateTable('txn.crm_order')
            .set({ combined_group_id: groupId })
            .where('batch_number', 'in', uniqueBatchNumbers)
            .execute();
        }
      });
      return Promise.all(uniqueBatchNumbers.map((batchNumber) => this.getOrder(batchNumber, userId)));
    }

    const active = await this.findActiveMachineOrder(machineCode);
    if (active && !uniqueBatchNumbers.includes(active.batchNumber)) {
      throw new Error(`ACTIVE_ORDER_CONFLICT:${active.batchNumber}`);
    }
    const { ManualRerollService } = await import('./ManualRerollService');
    await ManualRerollService.assertNoActiveReroll(machineCode);

    const statuses = startRows.map((r) => r.status);
    const isResume = statuses.every((s) => s === 'STOPPAGE' || s === 'IN_PROGRESS')
      && statuses.some((s) => s === 'STOPPAGE');
    const isFresh = statuses.every((s) => s === 'PENDING' || s === 'PREPARING' || s === 'IN_PROGRESS');

    if (!isResume && !isFresh) {
      throw new Error('Only pending, preparing, or stoppage (resume) orders can be started together');
    }
    if (isResume) {
      for (const row of startRows) {
        if (row.status === 'STOPPAGE') {
          await this.assertNoOpenStoppage(row.orderId);
        }
      }
    } else {
      for (const row of startRows) {
        if (row.status !== 'PENDING' && row.status !== 'PREPARING' && row.status !== 'IN_PROGRESS') {
          throw new Error('Only pending or preparing orders can be started together');
        }
      }
    }

    const startedAt = stamp;

    // Atomic: all succeed or none — same prod_start_at / group stamp.
    await db.transaction().execute(async (trx) => {
      for (const row of startRows) {
        if (row.status === 'IN_PROGRESS') {
          if (groupId) {
            await trx.updateTable('txn.crm_order')
              .set({ combined_group_id: groupId, updated_at: startedAt })
              .where('order_id', '=', row.orderId as any)
              .execute();
          }
          continue;
        }

        if (isResume && row.status === 'STOPPAGE') {
          await trx.updateTable('txn.crm_order')
            .set({
              status: 'IN_PROGRESS',
              updated_at: startedAt,
              ...(groupId ? { combined_group_id: groupId } : {}),
            })
            .where('order_id', '=', row.orderId as any)
            .execute();
          continue;
        }

        await trx.updateTable('txn.crm_order')
          .set({
            status: 'IN_PROGRESS',
            prod_start_at: startedAt,
            updated_at: startedAt,
            ...(groupId ? { combined_group_id: groupId } : {}),
          })
          .where('order_id', '=', row.orderId as any)
          .execute();

        await trx.updateTable('coil.coil')
          .set({ status: 'IN_PROCESS' })
          .where('coil_no', '=', row.coilNo)
          .execute();
      }

      if (groupId) {
        await trx.updateTable('txn.crm_order')
          .set({ combined_group_id: groupId })
          .where('batch_number', 'in', uniqueBatchNumbers)
          .execute();
      }
    });

    // Shift attribution after the atomic status transition (same active shift for all).
    let attributedShift: string | undefined = first.shift_code ?? undefined;
    for (const row of startRows) {
      if (isResume && row.status === 'IN_PROGRESS') continue;
      await this.reattributeOrderToActiveShift(row.orderId, userId, machineCode);
      const attributed = await db.selectFrom('txn.crm_order')
        .select('shift_code')
        .where('order_id', '=', row.orderId as any)
        .executeTakeFirst();
      if (attributed?.shift_code) attributedShift = attributed.shift_code;
    }

    // One machine RUNNING_STARTED for the combined logical job.
    MachineStateEventService.recordEvent(machineCode, 'RUNNING_STARTED', {
      orderId: startRows[0].orderId,
      batchNumber: startRows[0].batchNumber,
      operatorId: userId,
      shiftCode: attributedShift,
      meta: {
        combinedRunBatchNumbers: uniqueBatchNumbers,
        combinedResume: isResume || undefined,
      },
    }).catch((err) => console.error('[MachineStateEvent] RUNNING_STARTED failed:', err));

    return Promise.all(uniqueBatchNumbers.map((batchNumber) => this.getOrder(batchNumber, userId)));
  }

  static async endProduction(
    batchNumber: string,
    userId: number,
    defectCodes?: string[],
    combinedActualMt?: number,
  ) {
    // Task 5 / finding 4.2 (confirmed): do NOT reattribute at complete.
    // Keep start-shift credit — overtime completes stay on the shift where production started.
    const batchPre = await db.selectFrom('planning.ppc_batch')
      .select(['machine_code', 'shift_code'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    const machineCode = batchPre?.machine_code;
    if (!machineCode) throw new Error('Order has no machine assigned');
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);

    const order = await db.selectFrom('txn.crm_order').selectAll().where('batch_number', '=', batchNumber).executeTakeFirstOrThrow();
    if (order.status !== 'IN_PROGRESS' && order.status !== 'STOPPAGE') {
      throw new Error('Only running orders can be completed');
    }

    // Combined run: end the whole group together (same pattern as reject/hold cascade).
    let targets: Array<{ batch_number: string; order_id: string | number }> = [
      { batch_number: batchNumber, order_id: order.order_id },
    ];
    if (order.combined_group_id) {
      const groupRows = await db.selectFrom('txn.crm_order')
        .select(['batch_number', 'order_id'])
        .where('combined_group_id', '=', order.combined_group_id)
        .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
        .execute();
      if (groupRows.length > 0) {
        targets = groupRows.map((r) => ({
          batch_number: String(r.batch_number),
          order_id: r.order_id,
        }));
      }
    }

    // Validate stoppages before any writes.
    for (const target of targets) {
      await this.assertNoOpenStoppage(target.order_id);
    }

    const endAt = new Date();
    await db.transaction().execute(async (trx) => {
      if (order.combined_group_id) {
        await this.syncCombinedGroupProductionData(
          String(order.combined_group_id),
          batchNumber,
          userId,
          combinedActualMt,
          trx,
        );
      }

      for (const target of targets) {
        const missing = await this.getEndProductionMissingFieldsForOrder(String(target.order_id), trx);
        if (missing.length > 0) {
          throw new Error(
            targets.length > 1
              ? `Combined end blocked — ${target.batch_number} missing: ${missing.join(', ')}`
              : `Mandatory production data missing: ${missing.join(', ')}`,
          );
        }
        await this.completeSingleOrder(
          String(target.batch_number),
          target.order_id,
          userId,
          defectCodes,
          endAt,
          machineCode,
          batchPre?.shift_code ?? undefined,
          /* emitMachineIdle */ false,
          trx,
        );
      }
    });

    // Phase 1.3: shift production cache refresh after atomic completion (outside txn),
    // but do it fire-and-forget to keep end response latency low.
    void Promise.all(
      targets.map((target) => this.refreshShiftProductionFromOrder(String(target.order_id))),
    ).catch((err) => console.error('[SixHi] refreshShiftProductionFromOrder failed:', err));

    // One machine IDLE after the whole combined group completes.
    MachineStateEventService.recordEvent(machineCode, 'RUNNING_ENDED', {
      orderId: order.order_id,
      batchNumber,
      operatorId: userId,
      shiftCode: batchPre?.shift_code ?? undefined,
      meta: targets.length > 1
        ? { combinedEndBatchNumbers: targets.map((t) => t.batch_number) }
        : undefined,
    }).then(() =>
      MachineStateEventService.recordEvent(machineCode, 'IDLE_STARTED', {
        operatorId: userId,
        shiftCode: batchPre?.shift_code ?? undefined,
      }),
    ).catch((err) => console.error('[MachineStateEvent] RUNNING_ENDED/IDLE_STARTED failed:', err));

    // Slim end payload: client re-syncs full details via queue/state refresh.
    return {
      batchNumber,
      endedBatchNumbers: targets.map((t) => String(t.batch_number)),
    };
  }

  /**
   * Before combined end: copy recipe fields (passes/destination/thickness) from the
   * best-complete sibling and allocate combined actual weight across the group.
   * Fixes parked ends where only the primary order was filled in the UI.
   */
  private static async patchCombinedMemberActualWeight(
    orderId: string | number,
    subProcess: 'ROLLING' | 'SKIN_PASS',
    actualWeightMt: number,
    ex: DbExecutor,
  ): Promise<void> {
    if (subProcess === 'ROLLING') {
      const existing = await ex.selectFrom('txn.crm_rolling')
        .select('order_id')
        .where('order_id', '=', orderId as any)
        .executeTakeFirst();
      if (!existing) {
        await ex.insertInto('txn.crm_rolling')
          .values({
            order_id: orderId as any,
            destination: 'ANNEALING',
            destination_override: false,
          })
          .execute();
      }
      await ex.updateTable('txn.crm_rolling')
        .set({ actual_weight_mt: actualWeightMt })
        .where('order_id', '=', orderId as any)
        .execute();
    } else {
      const existing = await ex.selectFrom('txn.crm_skinpass')
        .select('order_id')
        .where('order_id', '=', orderId as any)
        .executeTakeFirst();
      if (!existing) {
        await ex.insertInto('txn.crm_skinpass')
          .values({ order_id: orderId as any })
          .execute();
      }
      await ex.updateTable('txn.crm_skinpass')
        .set({ actual_weight_mt: actualWeightMt })
        .where('order_id', '=', orderId as any)
        .execute();
    }
    await ex.updateTable('txn.crm_order')
      .set({ updated_at: new Date() })
      .where('order_id', '=', orderId as any)
      .execute();
  }

  private static async syncCombinedGroupProductionData(
    combinedGroupId: string,
    preferredBatchNumber: string,
    userId: number,
    combinedActualMt?: number,
    ex: DbExecutor = db,
  ): Promise<void> {
    const members = await ex.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([
        'o.order_id',
        'o.batch_number',
        'o.sub_process',
        'pb.ppc_weight_mt',
      ])
      .where('o.combined_group_id', '=', combinedGroupId)
      .where('o.status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .execute();
    if (members.length <= 1) return;

    const subProcess = members[0].sub_process as 'ROLLING' | 'SKIN_PASS';
    const targets = members.map((m) => ({
      batchNumber: String(m.batch_number),
      targetMt: Number(m.ppc_weight_mt ?? 0),
      orderId: m.order_id,
    }));

    if (subProcess === 'ROLLING') {
      type RollingSnap = {
        batchNumber: string;
        orderId: string | number;
        actualWeightMt: number | null;
        destination: string | null;
        destinationOverride: boolean | null;
        associateRw: string | null;
        etr: number | null;
        dtr: number | null;
        finalThkMm: number | null;
        passes: Array<{ passNo: number; thicknessMm: number }>;
      };

      const snaps: RollingSnap[] = [];
      for (const m of targets) {
        const rolling = await ex.selectFrom('txn.crm_rolling')
          .select([
            'actual_weight_mt',
            'destination',
            'destination_override',
            'associate_rw',
            'etr',
            'dtr',
            'final_thk_mm',
          ])
          .where('order_id', '=', m.orderId as any)
          .executeTakeFirst();
        const passes = await ex.selectFrom('txn.crm_rolling_pass')
          .select(['pass_no', 'thickness_mm'])
          .where('order_id', '=', m.orderId as any)
          .orderBy('pass_no', 'asc')
          .execute();
        snaps.push({
          batchNumber: m.batchNumber,
          orderId: m.orderId,
          actualWeightMt: rolling?.actual_weight_mt != null ? Number(rolling.actual_weight_mt) : null,
          destination: rolling?.destination ?? null,
          destinationOverride: rolling?.destination_override ?? null,
          associateRw: rolling?.associate_rw ?? null,
          etr: rolling?.etr != null ? Number(rolling.etr) : null,
          dtr: rolling?.dtr != null ? Number(rolling.dtr) : null,
          finalThkMm: rolling?.final_thk_mm != null ? Number(rolling.final_thk_mm) : null,
          passes: passes.map((p) => ({
            passNo: Number(p.pass_no),
            thicknessMm: Number(p.thickness_mm),
          })),
        });
      }

      const preferred = snaps.find((s) => s.batchNumber === preferredBatchNumber);
      const source = [preferred, ...snaps]
        .filter(Boolean)
        .find((s) => s && s.passes.length > 0 && s.destination)
        ?? snaps.find((s) => s.passes.length > 0)
        ?? preferred
        ?? snaps[0];
      if (!source) return;

      const allocation = allocateCombinedRemainderToBlanks(snaps, targets, combinedActualMt);

      for (const snap of snaps) {
        const alloc = allocation?.get(snap.batchNumber);
        const needsWeight = snap.actualWeightMt == null && alloc != null;
        const missingPasses = snap.passes.length === 0 && source.passes.length > 0;
        const missingDest = !snap.destination && !!source.destination;

        // Always persist allocated weight — do not require passes/destination copy first.
        if (needsWeight) {
          await this.patchCombinedMemberActualWeight(snap.orderId, 'ROLLING', alloc!, ex);
          snap.actualWeightMt = alloc!;
        }

        if (!missingPasses && !missingDest) continue;

        const destination = (missingDest ? source.destination : snap.destination)
          ?? source.destination;
        if (!destination) continue;
        const passes = missingPasses ? source.passes : snap.passes;
        if (passes.length === 0) continue;

        const data: SixHiRollingData = {
          actualWeightMt: snap.actualWeightMt ?? undefined,
          destination: destination as SixHiRollingData['destination'],
          destinationOverride: Boolean(
            (missingDest ? source.destinationOverride : snap.destinationOverride)
              ?? source.destinationOverride
              ?? false,
          ),
          associateRw: snap.associateRw ?? source.associateRw ?? undefined,
          etr: snap.etr ?? source.etr ?? undefined,
          dtr: snap.dtr ?? source.dtr ?? undefined,
          finalThkMm: snap.finalThkMm ?? source.finalThkMm ?? undefined,
          passes,
          totalPasses: passes.length,
        };
        await this.updateRolling(snap.batchNumber, data, userId, { skipCombinedSync: true, ex });
      }
      return;
    }

    // SKIN_PASS
    type SkinSnap = {
      batchNumber: string;
      orderId: string | number;
      actualWeightMt: number | null;
      outputThkMm: number | null;
      annHard: number | null;
      rwTension1: number | null;
      rwTension2: number | null;
      operatingMode: string | null;
      loadMinT: number | null;
      loadMaxT: number | null;
      stretchPct: number | null;
    };
    const snaps: SkinSnap[] = [];
    for (const m of targets) {
      const skin = await ex.selectFrom('txn.crm_skinpass')
        .select([
          'actual_weight_mt',
          'output_thk_mm',
          'ann_hard',
          'rw_tension_1',
          'rw_tension_2',
          'operating_mode',
          'load_min_t',
          'load_max_t',
          'stretch_pct',
        ])
        .where('order_id', '=', m.orderId as any)
        .executeTakeFirst();
      snaps.push({
        batchNumber: m.batchNumber,
        orderId: m.orderId,
        actualWeightMt: skin?.actual_weight_mt != null ? Number(skin.actual_weight_mt) : null,
        outputThkMm: skin?.output_thk_mm != null ? Number(skin.output_thk_mm) : null,
        annHard: skin?.ann_hard != null ? Number(skin.ann_hard) : null,
        rwTension1: skin?.rw_tension_1 != null ? Number(skin.rw_tension_1) : null,
        rwTension2: skin?.rw_tension_2 != null ? Number(skin.rw_tension_2) : null,
        operatingMode: skin?.operating_mode ?? null,
        loadMinT: skin?.load_min_t != null ? Number(skin.load_min_t) : null,
        loadMaxT: skin?.load_max_t != null ? Number(skin.load_max_t) : null,
        stretchPct: skin?.stretch_pct != null ? Number(skin.stretch_pct) : null,
      });
    }

    const preferred = snaps.find((s) => s.batchNumber === preferredBatchNumber);
    const source = [preferred, ...snaps]
      .filter(Boolean)
      .find((s) => s && s.outputThkMm != null && s.actualWeightMt != null)
      ?? snaps.find((s) => s.outputThkMm != null)
      ?? preferred
      ?? snaps[0];
    if (!source) return;

    const allocation = allocateCombinedRemainderToBlanks(snaps, targets, combinedActualMt);

    for (const snap of snaps) {
      const alloc = allocation?.get(snap.batchNumber);
      const needsWeight = snap.actualWeightMt == null && alloc != null;
      const missingThk = snap.outputThkMm == null && source.outputThkMm != null;

      if (needsWeight) {
        await this.patchCombinedMemberActualWeight(snap.orderId, 'SKIN_PASS', alloc!, ex);
        snap.actualWeightMt = alloc!;
      }

      if (!missingThk) continue;

      const data: SixHiSkinPassData = {
        actualWeightMt: snap.actualWeightMt ?? undefined,
        outputThkMm: missingThk ? source.outputThkMm! : (snap.outputThkMm ?? undefined),
        annHard: snap.annHard ?? source.annHard ?? undefined,
        rwTension1: snap.rwTension1 ?? source.rwTension1 ?? undefined,
        rwTension2: snap.rwTension2 ?? source.rwTension2 ?? undefined,
        operatingMode: (snap.operatingMode ?? source.operatingMode ?? undefined) as SixHiSkinPassData['operatingMode'],
        loadMinT: snap.loadMinT ?? source.loadMinT ?? undefined,
        loadMaxT: snap.loadMaxT ?? source.loadMaxT ?? undefined,
        stretchPct: snap.stretchPct ?? source.stretchPct ?? undefined,
      };
      await this.updateSkinPass(snap.batchNumber, data, userId, { skipCombinedSync: true, ex });
    }
  }

  private static async getEndProductionMissingFieldsForOrder(
    orderId: string,
    ex: DbExecutor = db,
  ): Promise<string[]> {
    const order = await ex.selectFrom('txn.crm_order')
      .select(['order_id', 'sub_process'])
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();
    const rolling = await ex.selectFrom('txn.crm_rolling')
      .select(['destination', 'actual_weight_mt', 'final_thk_mm'])
      .where('order_id', '=', order.order_id)
      .executeTakeFirst();
    const skinpass = await ex.selectFrom('txn.crm_skinpass')
      .select(['actual_weight_mt', 'output_thk_mm'])
      .where('order_id', '=', order.order_id)
      .executeTakeFirst();
    const passes = await ex.selectFrom('txn.crm_rolling_pass')
      .select('pass_no')
      .where('order_id', '=', order.order_id)
      .execute();

    const { getEndProductionMissingFields } = await import('@m1/shared-validation');
    return getEndProductionMissingFields({
      subProcess: order.sub_process as 'ROLLING' | 'SKIN_PASS',
      rolling: rolling
        ? {
            actualWeightMt: rolling.actual_weight_mt != null ? Number(rolling.actual_weight_mt) : null,
            destination: rolling.destination,
            passes,
          }
        : null,
      skinPass: skinpass
        ? {
            actualWeightMt: skinpass.actual_weight_mt != null ? Number(skinpass.actual_weight_mt) : null,
            outputThkMm: skinpass.output_thk_mm != null ? Number(skinpass.output_thk_mm) : null,
          }
        : null,
    });
  }

  /** Complete one CRM order. Combined end loops this for every group member. */
  private static async completeSingleOrder(
    batchNumber: string,
    orderId: string | number,
    userId: number,
    defectCodes: string[] | undefined,
    endAt: Date,
    machineCode: string,
    shiftCode: string | undefined,
    emitMachineIdle: boolean,
    trx: DbExecutor = db,
  ) {
    const order = await trx.selectFrom('txn.crm_order').selectAll()
      .where('order_id', '=', orderId as any)
      .executeTakeFirstOrThrow();
    if (order.status !== 'IN_PROGRESS' && order.status !== 'STOPPAGE') {
      return;
    }

    let durationMin: number | null = null;
    if (order.prod_start_at) {
      const totalStoppageMin = await this.totalStoppageMinutes(order.order_id, endAt);
      const wallMin = Math.round((endAt.getTime() - order.prod_start_at.getTime()) / 60000);
      durationMin = Math.max(0, wallMin - totalStoppageMin);
      await assertOrderRuntimeAccounting(order.order_id, durationMin, totalStoppageMin);
    }

    const rolling = await trx.selectFrom('txn.crm_rolling')
      .select(['destination', 'actual_weight_mt', 'final_thk_mm'])
      .where('order_id', '=', order.order_id)
      .executeTakeFirst();
    const skinpass = await trx.selectFrom('txn.crm_skinpass')
      .select(['actual_weight_mt', 'output_thk_mm'])
      .where('order_id', '=', order.order_id)
      .executeTakeFirst();

    await trx.updateTable('txn.crm_order')
      .set({
        status: 'COMPLETED',
        prod_end_at: endAt,
        prod_duration_min: durationMin,
        updated_at: endAt,
      })
      .where('order_id', '=', order.order_id)
      .execute();

    if (defectCodes && defectCodes.length > 0) {
      await trx.insertInto('txn.order_remark')
        .values({
          order_id: order.order_id,
          text: 'Minor defects logged during production completion',
          defect_codes: JSON.stringify(defectCodes),
          operator_id: userId,
        })
        .execute();

      for (const defectCode of defectCodes) {
        MachineStateEventService.recordEvent(machineCode, 'DEFECT_REPORTED', {
          orderId: order.order_id,
          batchNumber,
          operatorId: userId,
          shiftCode,
          categoryCode: defectCode,
          reason: 'Minor defect logged at completion',
        }).catch((err) => console.error('[MachineStateEvent] DEFECT_REPORTED failed:', err));
      }
    }

    const batch = await trx.selectFrom('planning.ppc_batch')
      .select(['customer_name', 'grade_code', 'width_mm', 'shift_code', 'process_route_raw'])
      .where('batch_id', '=', order.batch_id)
      .executeTakeFirst();

    const completionPayload = {
      outputThkMm: skinpass?.output_thk_mm ? Number(skinpass.output_thk_mm) : rolling?.final_thk_mm ? Number(rolling.final_thk_mm) : undefined,
      actualWeightMt: skinpass?.actual_weight_mt ? Number(skinpass.actual_weight_mt) : rolling?.actual_weight_mt ? Number(rolling.actual_weight_mt) : undefined,
      destination: rolling?.destination ?? undefined,
      gradeCode: batch?.grade_code,
      widthMm: batch?.width_mm ? Number(batch.width_mm) : undefined,
      customerName: batch?.customer_name,
      shiftCode: batch?.shift_code,
    };

    if (batch?.process_route_raw) {
      await ProcessRouteService.advanceJourney(batchNumber, completionPayload);
    } else {
      const nextDest = order.sub_process === 'SKIN_PASS'
        ? 'CTL'
        : rolling?.destination === 'REWINDING' ? 'RWD' : 'ANN';
      await trx.updateTable('coil.coil')
        .set({ status: 'DONE', next_dest: nextDest })
        .where('coil_no', '=', order.coil_no)
        .execute();
    }

    if (emitMachineIdle) {
      MachineStateEventService.recordEvent(machineCode, 'RUNNING_ENDED', {
        orderId: order.order_id,
        batchNumber: order.batch_number,
        operatorId: order.logged_in_user_id ?? undefined,
        shiftCode: batch?.shift_code ?? shiftCode,
      }).then(() =>
        MachineStateEventService.recordEvent(machineCode, 'IDLE_STARTED', {
          operatorId: order.logged_in_user_id ?? undefined,
          shiftCode: batch?.shift_code ?? shiftCode,
        }),
      ).catch((err) => console.error('[MachineStateEvent] RUNNING_ENDED/IDLE_STARTED failed:', err));
    }

    // Combined end refreshes shift cache once after the outer transaction commits.
    if (trx === db) {
      await this.refreshShiftProductionFromOrder(String(order.order_id));
    }
  }

  static async getEffectiveRuleset() {
    const configService = new ValidationConfigService(db);
    const rules = await configService.getConfiguredRules(false);
    const version = await configService.getVersion();
    return computeEffectiveRuleset(rules, version);
  }

  static async updateRolling(
    batchNumber: string,
    data: SixHiRollingData,
    userId: number,
    opts?: { skipCombinedSync?: boolean; ex?: DbExecutor },
  ) {
    const ex = opts?.ex ?? db;
    const orderId = await this.ensureOrder(batchNumber, userId);
    await assertCrm6OutputWeight(orderId, data.actualWeightMt ?? null);
    await assertActualWeightOcrCapture(orderId, data);

    const ruleset = await this.getEffectiveRuleset();
    const validationResult = evaluateRules({ rolling: data }, ruleset);
    if (!validationResult.isValid) {
      throw new Error('Validation failed: ' + validationResult.errors.map(e => e.message).join(', '));
    }

    const finalThk = data.passes.length > 0 ? data.passes[data.passes.length - 1].thicknessMm : data.finalThkMm;
    const ocrPatch = actualWeightOcrDbPatch(data);

    await ex.updateTable('txn.crm_rolling')
      .set({
        actual_weight_mt: data.actualWeightMt ?? null,
        destination: data.destination,
        destination_override: data.destinationOverride ?? false,
        associate_rw: data.associateRw ?? null,
        etr: data.etr ?? null,
        dtr: data.dtr ?? null,
        total_passes: data.passes.length,
        final_thk_mm: finalThk ?? null,
        ...(ocrPatch ?? {}),
      })
      .where('order_id', '=', orderId)
      .execute();

    await ex.deleteFrom('txn.crm_rolling_pass').where('order_id', '=', orderId).execute();
    if (data.passes.length > 0) {
      await ex.insertInto('txn.crm_rolling_pass')
        .values(data.passes.map((p) => ({
          order_id: orderId,
          pass_no: p.passNo,
          thickness_mm: p.thicknessMm,
        })))
        .execute();
    }

    await ex.updateTable('txn.crm_order').set({ updated_at: new Date() }).where('order_id', '=', orderId).execute();
    if (ex === db) {
      await this.refreshShiftProductionFromOrder(orderId);
    }

    if (!opts?.skipCombinedSync && ex === db) {
      const group = await db.selectFrom('txn.crm_order')
        .select('combined_group_id')
        .where('order_id', '=', orderId)
        .executeTakeFirst();
      if (group?.combined_group_id) {
        await this.syncCombinedGroupProductionData(String(group.combined_group_id), batchNumber, userId);
      }
    }

    return this.getOrder(batchNumber, userId);
  }

  static async updateSkinPass(
    batchNumber: string,
    data: SixHiSkinPassData,
    userId: number,
    opts?: { skipCombinedSync?: boolean; ex?: DbExecutor },
  ) {
    const ex = opts?.ex ?? db;
    const orderId = await this.ensureOrder(batchNumber, userId);
    await assertCrm6OutputWeight(orderId, data.actualWeightMt ?? null);
    await assertActualWeightOcrCapture(orderId, data);

    const ruleset = await this.getEffectiveRuleset();
    const validationResult = evaluateRules({ skinPass: data }, ruleset);
    if (!validationResult.isValid) {
      throw new Error('Validation failed: ' + validationResult.errors.map(e => e.message).join(', '));
    }

    const ocrPatch = actualWeightOcrDbPatch(data);

    await ex.updateTable('txn.crm_skinpass')
      .set({
        actual_weight_mt: data.actualWeightMt ?? null,
        output_thk_mm: data.outputThkMm ?? null,
        ann_hard: data.annHard ?? null,
        rw_tension_1: data.rwTension1 ?? null,
        rw_tension_2: data.rwTension2 ?? null,
        operating_mode: data.operatingMode ?? null,
        load_min_t: data.loadMinT ?? null,
        load_max_t: data.loadMaxT ?? null,
        stretch_pct: data.stretchPct ?? null,
        ...(ocrPatch ?? {}),
      })
      .where('order_id', '=', orderId)
      .execute();
    await ex.updateTable('txn.crm_order').set({ updated_at: new Date() }).where('order_id', '=', orderId).execute();
    if (ex === db) {
      await this.refreshShiftProductionFromOrder(orderId);
    }

    if (!opts?.skipCombinedSync && ex === db) {
      const group = await db.selectFrom('txn.crm_order')
        .select('combined_group_id')
        .where('order_id', '=', orderId)
        .executeTakeFirst();
      if (group?.combined_group_id) {
        await this.syncCombinedGroupProductionData(String(group.combined_group_id), batchNumber, userId);
      }
    }

    return this.getOrder(batchNumber, userId);
  }

  static async addStoppage(batchNumber: string, categoryCode: string, breakdownCode: string | undefined, remarks: string | undefined, userId: number) {
    const orderId = await this.ensureOrder(batchNumber, userId);
    const orderRow = await db.selectFrom('txn.crm_order')
      .select(['status', 'combined_group_id', 'order_id', 'batch_number'])
      .where('order_id', '=', orderId)
      .executeTakeFirstOrThrow();

    if (orderRow.status !== 'IN_PROGRESS' && orderRow.status !== 'STOPPAGE') {
      throw new Error('Stoppage can only be recorded while production is running');
    }

    // Expand to every running combined sibling — one logical stoppage for the group.
    let targets: Array<{ order_id: string | number; batch_number: string; status: string }> = [
      { order_id: orderId, batch_number: batchNumber, status: orderRow.status },
    ];
    if (orderRow.combined_group_id) {
      const members = await this.loadCombinedGroupMembers(
        String(orderRow.combined_group_id),
        ['IN_PROGRESS', 'STOPPAGE'],
      );
      targets = members.map((m) => ({
        order_id: m.order_id,
        batch_number: String(m.batch_number),
        status: m.status,
      }));
    }

    // Skip members that already have an open stoppage (idempotent for retries).
    const eligible: typeof targets = [];
    const targetIds = targets.map((t) => t.order_id);
    const openRows = targetIds.length > 0
      ? await db.selectFrom('txn.stoppage')
        .select('order_id')
        .where('order_id', 'in', targetIds as any[])
        .where('end_at', 'is', null)
        .execute()
      : [];
    const openSet = new Set(openRows.map((r) => String(r.order_id)));
    for (const target of targets) {
      if (openSet.has(String(target.order_id))) continue;
      if (target.status !== 'IN_PROGRESS' && target.status !== 'STOPPAGE') {
        throw new Error(`Stoppage blocked — ${target.batch_number} is not running`);
      }
      // open-set already covers assertCanStartOrderStoppage
      eligible.push(target);
    }
    if (eligible.length === 0) {
      return this.getOrder(batchNumber, userId);
    }

    const startAt = new Date();
    for (const target of eligible) {
      await validateOrderStoppageStart(target.order_id, startAt);
    }

    await db.transaction().execute(async (trx) => {
      for (const target of eligible) {
        const orderMeta = await trx.selectFrom('txn.crm_order')
          .select(['shift_log_id', 'shift_code', 'prod_date'])
          .where('order_id', '=', target.order_id as any)
          .executeTakeFirst();
        let shiftLogId = orderMeta?.shift_log_id != null ? String(orderMeta.shift_log_id) : null;
        let shiftCode = orderMeta?.shift_code ?? null;
        let prodDate: string | Date | null = orderMeta?.prod_date ?? null;
        if (!shiftLogId) {
          const processId = await this.getProcessId();
          const resolved = await ShiftDetectionService.resolveShift({
            userId,
            processId,
            orderId: String(target.order_id),
          });
          shiftLogId = resolved.shiftLogId;
          shiftCode = resolved.shiftCode;
          prodDate = postgresDateOnly(resolved.prodDate);
        }

        await trx.insertInto('txn.stoppage')
          .values({
            order_id: target.order_id as any,
            category_code: categoryCode,
            breakdown_code: breakdownCode ?? null,
            remarks: remarks ?? null,
            operator_id: userId,
            start_at: startAt,
            shift_log_id: shiftLogId,
            shift_code: shiftCode,
            prod_date: prodDate != null ? postgresDateOnly(prodDate) : null,
          } as any)
          .execute();
        await trx.updateTable('txn.crm_order')
          .set({ status: 'STOPPAGE', updated_at: startAt })
          .where('order_id', '=', target.order_id as any)
          .execute();
      }
    });

    // One machine stoppage event for the logical combined job.
    const ppc = await db.selectFrom('planning.ppc_batch').select(['machine_code', 'shift_code']).where('batch_number', '=', batchNumber).executeTakeFirst();
    if (ppc) {
      MachineStateEventService.recordEvent(ppc.machine_code, 'STOPPAGE_STARTED', {
        orderId,
        batchNumber,
        operatorId: userId,
        shiftCode: ppc.shift_code,
        categoryCode,
        reason: remarks ?? categoryCode,
        meta: eligible.length > 1
          ? { combinedStoppageBatchNumbers: eligible.map((t) => t.batch_number) }
          : undefined,
      }).catch((err) => console.error('[MachineStateEvent] STOPPAGE_STARTED failed:', err));
    }

    return this.getOrder(batchNumber, userId);
  }

  static async updateStoppage(batchNumber: string, stoppageId: string, categoryCode: string, breakdownCode: string | undefined, remarks: string | undefined, userId: number) {
    await this.ensureOrder(batchNumber, userId);
    const { targets, combinedGroupId } = await this.resolveCombinedLifecycleTargets(
      batchNumber,
      ['IN_PROGRESS', 'STOPPAGE'],
    );

    await db.transaction().execute(async (trx) => {
      if (!combinedGroupId) {
        await trx.updateTable('txn.stoppage')
          .set({
            category_code: categoryCode,
            breakdown_code: breakdownCode ?? null,
            remarks: remarks ?? null,
          })
          .where('order_id', '=', targets[0].order_id as any)
          .where('stoppage_id', '=', stoppageId)
          .execute();
        return;
      }

      for (const target of targets) {
        const open = await trx.selectFrom('txn.stoppage')
          .select('stoppage_id')
          .where('order_id', '=', target.order_id as any)
          .where('end_at', 'is', null)
          .executeTakeFirst();
        if (!open) continue;
        await trx.updateTable('txn.stoppage')
          .set({
            category_code: categoryCode,
            breakdown_code: breakdownCode ?? null,
            remarks: remarks ?? null,
          })
          .where('stoppage_id', '=', open.stoppage_id)
          .execute();
      }
    });
    return this.getOrder(batchNumber, userId);
  }

  static async endStoppage(batchNumber: string, stoppageId: string, userId: number) {
    await this.ensureOrder(batchNumber, userId);
    const { targets, combinedGroupId } = await this.resolveCombinedLifecycleTargets(
      batchNumber,
      ['IN_PROGRESS', 'STOPPAGE'],
    );

    const primary = targets.find((t) => t.batch_number === batchNumber) ?? targets[0];
    const primaryStop = await db.selectFrom('txn.stoppage')
      .selectAll()
      .where('stoppage_id', '=', stoppageId)
      .executeTakeFirstOrThrow();
    if (String(primaryStop.order_id) !== String(primary.order_id) && !combinedGroupId) {
      throw new Error('Stoppage does not belong to this order');
    }
    if (primaryStop.end_at && !combinedGroupId) {
      return this.getOrder(batchNumber, userId);
    }

    const endAt = new Date();

    // Collect open stoppages for every group member (or the single primary).
    const openStops: Array<{
      order_id: string | number;
      batch_number: string;
      stoppage_id: string | number;
      start_at: Date;
      prod_start_at: Date | null;
    }> = [];

    for (const target of targets) {
      const open = await db.selectFrom('txn.stoppage')
        .select(['stoppage_id', 'start_at', 'end_at'])
        .where('order_id', '=', target.order_id as any)
        .where('end_at', 'is', null)
        .executeTakeFirst();
      if (!open) continue;
      await validateOrderStoppageInterval(target.order_id, open.start_at, endAt, String(open.stoppage_id));
      openStops.push({
        order_id: target.order_id,
        batch_number: target.batch_number,
        stoppage_id: open.stoppage_id,
        start_at: open.start_at,
        prod_start_at: target.prod_start_at,
      });
    }

    if (openStops.length === 0) {
      return this.getOrder(batchNumber, userId);
    }

    await db.transaction().execute(async (trx) => {
      for (const stop of openStops) {
        const durationMin = resolveStoppageMinutes(stop.start_at, endAt, null);
        await trx.updateTable('txn.stoppage')
          .set({ end_at: endAt, duration_min: durationMin })
          .where('stoppage_id', '=', stop.stoppage_id as any)
          .execute();

        const stillOpen = await trx.selectFrom('txn.stoppage')
          .select(db.fn.count('stoppage_id').as('c'))
          .where('order_id', '=', stop.order_id as any)
          .where('end_at', 'is', null)
          .executeTakeFirst();
        if (Number(stillOpen?.c ?? 0) === 0) {
          const resumingToRunning = !!stop.prod_start_at;
          await trx.updateTable('txn.crm_order')
            .set({ status: resumingToRunning ? 'IN_PROGRESS' : 'PENDING', updated_at: endAt })
            .where('order_id', '=', stop.order_id as any)
            .execute();
        }
      }
    });

    const ppc = await db.selectFrom('planning.ppc_batch')
      .select(['machine_code', 'shift_code'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    const anyResuming = openStops.some((s) => !!s.prod_start_at);
    if (ppc) {
      try {
        await MachineStateEventService.recordEvent(ppc.machine_code, 'STOPPAGE_ENDED', {
          orderId: primary.order_id,
          batchNumber,
          operatorId: userId,
          shiftCode: ppc.shift_code,
          meta: openStops.length > 1
            ? { combinedResumeBatchNumbers: openStops.map((s) => s.batch_number) }
            : undefined,
        });
        const nextEvent = anyResuming ? 'RUNNING_STARTED' : 'IDLE_STARTED';
        await MachineStateEventService.recordEvent(ppc.machine_code, nextEvent, {
          orderId: anyResuming ? primary.order_id : undefined,
          batchNumber: anyResuming ? batchNumber : undefined,
          operatorId: userId,
          shiftCode: ppc.shift_code,
        });
      } catch (err) {
        console.error('[MachineStateEvent] STOPPAGE_ENDED follow-up failed:', err);
      }
    }

    return this.getOrder(batchNumber, userId);
  }

  static async addRemark(
    batchNumber: string,
    text: string,
    userId: number,
    defects?: { defectCode: string; quantityAffected?: number; remarks?: string }[],
  ) {
    const orderId = await this.ensureOrder(batchNumber, userId);
    await assertCrm6DefectQuantities(orderId, defects);

    const { targets } = await this.resolveCombinedLifecycleTargets(batchNumber);

    const defectJson = defects?.length ? JSON.stringify(defects) : null;
    const stampedAt = new Date();
    await db.transaction().execute(async (trx) => {
      for (const target of targets) {
        await trx.insertInto('txn.order_remark')
          .values({
            order_id: target.order_id as any,
            text,
            operator_id: userId,
            defect_codes: defectJson,
            created_at: stampedAt,
          } as any)
          .execute();
      }
    });
    return this.getOrder(batchNumber, userId);
  }

  static async getShiftStoppages(shiftLogId: string, machineCode?: string | string[]) {
    // Order-linked stoppages (via order shift attribution) + manual machine stoppages
    // (order_id IS NULL, keyed by stoppage.shift_log_id).
    const machineCodes = machineCode == null
      ? null
      : Array.isArray(machineCode) ? machineCode.map((m) => m.toUpperCase()).filter(Boolean) : [machineCode.toUpperCase()];

    let orderQuery = db.selectFrom('txn.stoppage as os')
      .innerJoin('txn.crm_order as o', 'o.order_id', 'os.order_id')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .innerJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
      .select([
        'os.stoppage_id',
        'os.category_code',
        'sc.label',
        'sc.requires_breakdown_code',
        'os.breakdown_code',
        'os.start_at',
        'os.end_at',
        'os.duration_min',
        'os.remarks',
        'o.batch_number',
      ])
      .where('o.shift_log_id', '=', shiftLogId);

    if (machineCodes && machineCodes.length > 0) {
      orderQuery = machineCodes.length === 1
        ? orderQuery.where('pb.machine_code', '=', machineCodes[0])
        : orderQuery.where('pb.machine_code', 'in', machineCodes);
    }

    let manualQuery = db.selectFrom('txn.stoppage as os')
      .innerJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
      .select([
        'os.stoppage_id',
        'os.category_code',
        'sc.label',
        'sc.requires_breakdown_code',
        'os.breakdown_code',
        'os.start_at',
        'os.end_at',
        'os.duration_min',
        'os.remarks',
      ])
      .where('os.order_id', 'is', null)
      .where('os.shift_log_id', '=', shiftLogId);

    if (machineCodes && machineCodes.length > 0) {
      manualQuery = machineCodes.length === 1
        ? manualQuery.where('os.machine_code', '=', machineCodes[0])
        : manualQuery.where('os.machine_code', 'in', machineCodes);
    }

    const [orderRows, manualRows] = await Promise.all([
      orderQuery.execute(),
      manualQuery.execute(),
    ]);

    const mapped = [
      ...orderRows.map((s) => ({
        id: String(s.stoppage_id),
        batchNumber: s.batch_number as string | undefined,
        categoryCode: s.category_code,
        categoryLabel: s.label,
        requiresBreakdownCode: !!s.requires_breakdown_code,
        breakdownCode: s.breakdown_code ?? undefined,
        startAt: s.start_at.toISOString(),
        endAt: s.end_at?.toISOString(),
        durationMin: resolveStoppageMinutes(s.start_at, s.end_at, s.duration_min),
        remarks: s.remarks ?? undefined,
      })),
      ...manualRows.map((s) => ({
        id: String(s.stoppage_id),
        batchNumber: undefined as string | undefined,
        categoryCode: s.category_code,
        categoryLabel: s.label,
        requiresBreakdownCode: !!s.requires_breakdown_code,
        breakdownCode: s.breakdown_code ?? undefined,
        startAt: s.start_at.toISOString(),
        endAt: s.end_at?.toISOString(),
        durationMin: resolveStoppageMinutes(s.start_at, s.end_at, s.duration_min),
        remarks: s.remarks ?? undefined,
      })),
    ];

    mapped.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
    return mapped;
  }

  static async getStoppageCategories() {
    const categories = await db.selectFrom('master.stoppage_category')
      .selectAll()
      .orderBy('category_code', 'asc')
      .execute();
    const codes = await db.selectFrom('master.stoppage_code')
      .selectAll()
      .orderBy('stoppage_code', 'asc')
      .execute();
    return {
      categories: categories.map((c) => ({
        categoryCode: c.category_code,
        label: c.label,
        requiresBreakdownCode: c.requires_breakdown_code,
        isActive: true,
      })),
      breakdownCodes: codes.map((c) => ({
        stoppageCode: c.stoppage_code,
        description: c.description,
        category: c.category,
        isActive: c.is_active ?? true,
      })),
    };
  }

  static async saveStoppageCategory(data: { categoryCode: string; label: string; requiresBreakdownCode: boolean }) {
    await db.insertInto('master.stoppage_category')
      .values({
        category_code: data.categoryCode,
        label: data.label,
        requires_breakdown_code: data.requiresBreakdownCode,
      })
      .onConflict(oc => oc.column('category_code').doUpdateSet({
        label: data.label,
        requires_breakdown_code: data.requiresBreakdownCode,
      }))
      .execute();
    return this.getStoppageCategories();
  }

  static async toggleStoppageCategory(categoryCode: string, isActive: boolean) {
    if (!isActive) {
      await db.deleteFrom('master.stoppage_category')
        .where('category_code', '=', categoryCode)
        .execute();
    }
    return this.getStoppageCategories();
  }

  static async saveStoppageCode(data: { stoppageCode: string; description: string; category: string }) {
    await db.insertInto('master.stoppage_code')
      .values({
        stoppage_code: data.stoppageCode,
        description: data.description,
        category: data.category,
      })
      .onConflict(oc => oc.column('stoppage_code').doUpdateSet({
        description: data.description,
        category: data.category,
      }))
      .execute();
    return this.getStoppageCategories();
  }

  static async toggleStoppageCode(stoppageCode: string, isActive: boolean) {
    await db.updateTable('master.stoppage_code')
      .set({ is_active: isActive })
      .where('stoppage_code', '=', stoppageCode)
      .execute();
    return this.getStoppageCategories();
  }

  static async getDefectCodes(machine?: string) {
    const codes = await db.selectFrom('master.defect_code')
      .selectAll()
      .where('is_active', 'is not', false)
      .execute();

    const { matchesMachineClassification } = await import('@m1/shared-validation');
    const scoped = machine
      ? codes.filter((c) => matchesMachineClassification(c.applies_to, machine))
      : codes;

    const mapped = scoped.map((c) => ({
      defectCode: c.defect_code,
      defectName: c.description,
      category: c.applies_to,
      isActive: c.is_active ?? true,
    }));
    mapped.sort((a, b) => {
      const numA = /^\d+$/.test(a.defectCode) ? Number.parseInt(a.defectCode, 10) : Number.MAX_SAFE_INTEGER;
      const numB = /^\d+$/.test(b.defectCode) ? Number.parseInt(b.defectCode, 10) : Number.MAX_SAFE_INTEGER;
      if (numA !== numB) return numA - numB;
      return a.defectCode.localeCompare(b.defectCode, undefined, { numeric: true });
    });
    return mapped;
  }

  static async saveDefectCode(data: { defectCode: string; defectName: string; category?: string | null }) {
    await db.insertInto('master.defect_code')
      .values({
        defect_code: data.defectCode,
        description: data.defectName,
        applies_to: data.category ?? null,
      })
      .onConflict(oc => oc.column('defect_code').doUpdateSet({
        description: data.defectName,
        applies_to: data.category ?? null,
      }))
      .execute();
    return this.getDefectCodes();
  }

  static async toggleDefectCode(defectCode: string, isActive: boolean) {
    await db.updateTable('master.defect_code')
      .set({ is_active: isActive })
      .where('defect_code', '=', defectCode)
      .execute();
    return this.getDefectCodes();
  }

  static async deleteOrder(batchNumber: string, _userId: number): Promise<{ batchNumber: string }> {
    const batch = await db.selectFrom('planning.ppc_batch')
      .select(['batch_id', 'coil_no', 'machine_code'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch) throw new Error('Order not found');

    const order = await db.selectFrom('txn.crm_order')
      .select(['order_id', 'status', 'prod_start_at', 'coil_no'])
      .where('batch_id', '=', batch.batch_id)
      .executeTakeFirst();

    if (!order) {
      throw new Error('No production record exists for this order');
    }

    const deletableStatuses = ['PENDING', 'PREPARING', 'IN_PROGRESS', 'STOPPAGE', 'COMPLETED', 'REJECTED'];
    if (!deletableStatuses.includes(order.status)) {
      throw new Error(`Orders with status ${order.status} cannot be deleted`);
    }

    const openStoppage = await db.selectFrom('txn.stoppage')
      .select('stoppage_id')
      .where('order_id', '=', order.order_id)
      .where('end_at', 'is', null)
      .executeTakeFirst();

    if (openStoppage) {
      await db.updateTable('txn.stoppage')
        .set({ end_at: new Date(), duration_min: 0 })
        .where('stoppage_id', '=', openStoppage.stoppage_id)
        .execute();
    }

    if (order.status === 'IN_PROGRESS' || order.status === 'STOPPAGE') {
      const machineCode = batch.machine_code;
      if (machineCode) {
        await MachineStateEventService.recordEvent(machineCode, 'RUNNING_ENDED', { batchNumber });
        await MachineStateEventService.recordEvent(machineCode, 'IDLE_STARTED');
      }
    }

    await db.deleteFrom('txn.crm_order').where('order_id', '=', order.order_id).execute();

    const coilNo = order.coil_no ?? batch.coil_no;
    if (coilNo) {
      await db.updateTable('coil.coil')
        .set({ status: 'PLANNED' })
        .where('coil_no', '=', coilNo)
        .execute();
    }

    return { batchNumber };
  }

  static async rejectOrder(
    batchNumber: string,
    rejectionReason: string,
    defectCodes: string[],
    remarks: string,
    userId: number,
  ) {
    const trimmedRemarks = remarks?.trim();
    if (!rejectionReason?.trim()) {
      throw new Error('Hold reason is required');
    }
    if (!trimmedRemarks) {
      throw new Error('Hold remarks are required');
    }

    const orderId = await this.ensureOrder(batchNumber, userId);
    const current = await db.selectFrom('txn.crm_order')
      .select(['order_id', 'status', 'combined_group_id', 'batch_number'])
      .where('order_id', '=', orderId)
      .executeTakeFirstOrThrow();

    // Re-holding an already-REJECTED order (with no active group mates) is a no-op.
    if (current.status === 'REJECTED' && !current.combined_group_id) {
      return this.getOrder(batchNumber, userId);
    }

    let targets: Array<{ order_id: string | number; batch_number: string }> = [
      { order_id: orderId, batch_number: batchNumber },
    ];
    if (current.combined_group_id) {
      targets = await db.selectFrom('txn.crm_order')
        .select(['order_id', 'batch_number'])
        .where('combined_group_id', '=', current.combined_group_id)
        .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE', 'PENDING', 'PREPARING'])
        .execute();
      if (targets.length === 0) {
        return this.getOrder(batchNumber, userId);
      }
    } else if (current.status === 'REJECTED') {
      return this.getOrder(batchNumber, userId);
    }

    const reasonLabel = rejectionReason.trim().slice(0, 100);

    // Attribute each target to the operator's active shift before the hold write txn.
    for (const target of targets) {
      const ppc = await db.selectFrom('planning.ppc_batch')
        .select('machine_code')
        .where('batch_number', '=', String(target.batch_number))
        .executeTakeFirst();
      await this.reattributeOrderToActiveShift(target.order_id as any, userId, ppc?.machine_code);
    }

    await db.transaction().execute(async (trx) => {
      for (const target of targets) {
        await this.rejectSingleOrder(
          trx as any,
          String(target.batch_number),
          String(target.order_id),
          reasonLabel,
          defectCodes,
          trimmedRemarks,
          userId,
        );
      }
    });

    return this.getOrder(batchNumber, userId);
  }

  /** Hold a single CRM order. Caller owns the transaction when cascading a combined group. */
  private static async rejectSingleOrder(
    trx: typeof db,
    batchNumber: string,
    orderId: string,
    reasonLabel: string,
    defectCodes: string[],
    trimmedRemarks: string,
    userId: number,
  ) {
    const existing = await trx.selectFrom('txn.crm_order')
      .select('status')
      .where('order_id', '=', orderId as any)
      .executeTakeFirst();
    if (!existing || existing.status === 'REJECTED') {
      return;
    }

    const ppc = await trx.selectFrom('planning.ppc_batch')
      .select(['machine_code', 'shift_code'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();

    const holdShift = await trx.selectFrom('txn.crm_order')
      .select('shift_code')
      .where('order_id', '=', orderId as any)
      .executeTakeFirst();
    const eventShift = holdShift?.shift_code ?? ppc?.shift_code;

    await trx.insertInto('txn.order_rejection')
      .values({
        order_id: orderId as any,
        rejection_reason: reasonLabel,
        defect_codes: defectCodes.length ? JSON.stringify(defectCodes) : null,
        remarks: trimmedRemarks,
        operator_id: userId,
        tenant_id: getTenantId() || '00000000-0000-0000-0000-000000000001',
      })
      .execute();

    const activeStoppage = await trx.selectFrom('txn.stoppage')
      .select('stoppage_id')
      .where('order_id', '=', orderId as any)
      .where('end_at', 'is', null)
      .executeTakeFirst();

    if (activeStoppage) {
      const stop = await trx.selectFrom('txn.stoppage')
        .selectAll()
        .where('stoppage_id', '=', activeStoppage.stoppage_id)
        .executeTakeFirstOrThrow();
      const endAt = new Date();
      await validateOrderStoppageInterval(orderId as any, stop.start_at, endAt, String(activeStoppage.stoppage_id));
      const durationMin = resolveStoppageMinutes(stop.start_at, endAt, null);
      await trx.updateTable('txn.stoppage')
        .set({ end_at: endAt, duration_min: durationMin })
        .where('stoppage_id', '=', activeStoppage.stoppage_id)
        .execute();
    }

    await trx.updateTable('txn.crm_order')
      .set({
        status: 'REJECTED',
        updated_at: new Date(),
        prod_end_at: new Date(),
      })
      .where('order_id', '=', orderId as any)
      .execute();

    if (ppc) {
      MachineStateEventService.recordEvent(ppc.machine_code, 'RUNNING_ENDED', {
        orderId: orderId as any,
        batchNumber,
        operatorId: userId,
        shiftCode: eventShift,
      })
        .then(() => MachineStateEventService.recordEvent(ppc.machine_code, 'IDLE_STARTED', {
          orderId: orderId as any, batchNumber, operatorId: userId, shiftCode: eventShift,
        }))
        .then(() => MachineStateEventService.recordEvent(ppc.machine_code, 'ORDER_REJECTED', {
          orderId: orderId as any, batchNumber, operatorId: userId, shiftCode: eventShift, reason: trimmedRemarks,
        }))
        .then(async () => {
          for (const defectCode of defectCodes) {
            await MachineStateEventService.recordEvent(ppc.machine_code, 'DEFECT_REPORTED', {
              orderId: orderId as any, batchNumber, operatorId: userId, shiftCode: eventShift,
              categoryCode: defectCode, reason: 'Defect causing rejection',
            });
          }
        })
        .catch((err) => console.error('[MachineStateEvent] REJECT events failed:', err));
    }
  }

  static async reinstateOrder(
    batchNumber: string,
    userId: number,
    target: 'PREPARING' | 'PENDING' = 'PREPARING',
  ) {
    const batch = await db.selectFrom('planning.ppc_batch')
      .select(['batch_id', 'coil_no', 'machine_code', 'shift_code'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch) throw new Error('Order not found');

    const order = await db.selectFrom('txn.crm_order')
      .select(['order_id', 'status', 'coil_no', 'combined_group_id'])
      .where('batch_id', '=', batch.batch_id)
      .executeTakeFirst();

    if (!order) throw new Error('No production record exists for this order');
    if (order.status !== 'REJECTED' && !order.combined_group_id) {
      throw new Error('Order is not on hold');
    }

    let targets: Array<{ order_id: string | number; batch_number: string; coil_no: string | null }> = [
      { order_id: order.order_id, batch_number: batchNumber, coil_no: order.coil_no ?? batch.coil_no },
    ];
    if (order.combined_group_id) {
      targets = await db.selectFrom('txn.crm_order')
        .select(['order_id', 'batch_number', 'coil_no'])
        .where('combined_group_id', '=', order.combined_group_id)
        .where('status', '=', 'REJECTED')
        .execute();
    } else if (order.status !== 'REJECTED') {
      throw new Error('Order is not on hold');
    }

    await db.transaction().execute(async (trx) => {
      for (const t of targets) {
        await this.reinstateSingleOrder(
          String(t.batch_number),
          String(t.order_id),
          t.coil_no ?? batch.coil_no,
          batch.machine_code,
          batch.shift_code,
          userId,
          target,
          trx as any,
        );
      }
    });

    return this.getOrder(batchNumber, userId);
  }

  private static async reinstateSingleOrder(
    batchNumber: string,
    orderId: string,
    coilNo: string | null,
    machineCode: string | null | undefined,
    shiftCode: string | null | undefined,
    userId: number,
    target: 'PREPARING' | 'PENDING',
    trx: typeof db = db,
  ) {
    const latestRejection = await trx.selectFrom('txn.order_rejection')
      .select('rejection_id')
      .where('order_id', '=', orderId as any)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    if (latestRejection) {
      await trx.deleteFrom('txn.order_rejection')
        .where('rejection_id', '=', latestRejection.rejection_id)
        .execute();
    }

    await trx.updateTable('txn.crm_order')
      .set({
        status: target,
        prod_start_at: null,
        prod_end_at: null,
        prod_duration_min: null,
        updated_at: new Date(),
      })
      .where('order_id', '=', orderId as any)
      .execute();

    if (coilNo) {
      await trx.updateTable('coil.coil')
        .set({ status: 'PLANNED' })
        .where('coil_no', '=', coilNo)
        .execute();
    }

    if (machineCode) {
      MachineStateEventService.recordEvent(machineCode, 'ORDER_REINSTATED', {
        orderId: orderId as any,
        batchNumber,
        operatorId: userId,
        shiftCode: shiftCode ?? undefined,
      })
        .then(() => MachineStateEventService.recordEvent(machineCode!, 'IDLE_STARTED', {
          orderId: orderId as any,
          batchNumber,
          operatorId: userId,
          shiftCode: shiftCode ?? undefined,
        }))
        .catch((err) => console.error('[MachineStateEvent] REINSTATE events failed:', err));
    }
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
    const row = await db.selectFrom('master.stoppage_category')
      .select(['label'])
      .where('category_code', '=', categoryCode)
      .executeTakeFirst();
    return row?.label ?? categoryCode;
  }

  static async getManualStoppageStatus(machineCode: string) {
    const activeOrder = await this.findActiveMachineOrder(machineCode);
    const currentEvent = await MachineStateEventService.getCurrentEvent(machineCode);
    const isManualStoppage = Boolean(
      currentEvent
      && currentEvent.event_type === 'STOPPAGE_STARTED'
      && !currentEvent.batch_number,
    );

    if (!isManualStoppage || !currentEvent) {
      return { eligible: !activeOrder, active: null };
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
        rollInNo: typeof meta.rollInNo === 'string' ? meta.rollInNo : undefined,
        rollInCode: typeof meta.rollInCode === 'string' ? meta.rollInCode : undefined,
        rollOutNo: typeof meta.rollOutNo === 'string' ? meta.rollOutNo : undefined,
        rollOutCode: typeof meta.rollOutCode === 'string' ? meta.rollOutCode : undefined,
      },
    };
  }

  static async startManualStoppage(
    machineCode: string,
    categoryCode: string,
    breakdownCode: string | undefined,
    remarks: string | undefined,
    userId: number,
    rollMeta?: {
      rollInNo?: string;
      rollInCode?: string;
      rollOutNo?: string;
      rollOutCode?: string;
    },
  ) {
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);

    const activeOrder = await this.findActiveMachineOrder(machineCode);
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
      meta: {
        manual: true,
        breakdownCode: breakdownCode ?? null,
        ...rollMeta,
      },
    });

    return this.getManualStoppageStatus(machineCode);
  }

  static async updateManualStoppage(
    machineCode: string,
    categoryCode: string,
    breakdownCode: string | undefined,
    remarks: string | undefined,
    rollChange?: {
      rollPosition?: 'IN' | 'OUT';
      newRollNo?: string;
      newRollCode?: string;
    },
  ) {
    const currentEvent = await MachineStateEventService.getCurrentEvent(machineCode);
    if (!currentEvent || currentEvent.event_type !== 'STOPPAGE_STARTED' || currentEvent.batch_number) {
      throw new Error('No active manual stoppage on this machine');
    }

    const meta = this.parseMachineEventMeta(currentEvent.meta);
    const nextMeta: Record<string, unknown> = {
      ...meta,
      manual: true,
      breakdownCode: breakdownCode ?? meta.breakdownCode ?? null,
    };

    if (rollChange?.rollPosition === 'IN' && rollChange.newRollNo?.trim()) {
      nextMeta.rollInNo = rollChange.newRollNo.trim();
      if (rollChange.newRollCode?.trim()) nextMeta.rollInCode = rollChange.newRollCode.trim();
    }
    if (rollChange?.rollPosition === 'OUT' && rollChange.newRollNo?.trim()) {
      nextMeta.rollOutNo = rollChange.newRollNo.trim();
      if (rollChange.newRollCode?.trim()) nextMeta.rollOutCode = rollChange.newRollCode.trim();
    }

    await MachineStateEventService.updateOpenEvent(currentEvent.event_id, {
      categoryCode,
      reason: remarks,
      meta: nextMeta,
    });

    // Keep txn.stoppage in sync (status rail updates events; history/handover read the table).
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

    return this.getManualStoppageStatus(machineCode);
  }

  static async endManualStoppage(machineCode: string, userId: number) {
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

    return this.getManualStoppageStatus(machineCode);
  }

  static async logRollChange(
    batchNumber: string,
    rollPosition: 'IN' | 'OUT',
    newRollNo: string,
    newRollCode: string | undefined,
    reasonText: string | undefined,
    userId: number,
  ) {
    await this.ensureOrder(batchNumber, userId);
    const { targets } = await this.resolveCombinedLifecycleTargets(
      batchNumber,
      ['IN_PROGRESS', 'STOPPAGE', 'PENDING', 'PREPARING', 'COMPLETED'],
    );

    await db.transaction().execute(async (trx) => {
      for (const target of targets) {
        const rolling = await trx.selectFrom('txn.crm_rolling')
          .selectAll()
          .where('order_id', '=', target.order_id as any)
          .executeTakeFirst();
        const prevNo = rollPosition === 'IN' ? rolling?.roll_in_no : rolling?.roll_out_no;
        const prevCode = rollPosition === 'IN' ? rolling?.roll_in_code : rolling?.roll_out_code;

        await trx.insertInto('txn.crm_roll_change')
          .values({
            order_id: target.order_id as any,
            roll_position: rollPosition,
            prev_roll_no: prevNo,
            prev_roll_code: prevCode,
            new_roll_no: newRollNo,
            new_roll_code: newRollCode ?? null,
            reason_text: reasonText ?? null,
            operator_id: userId,
          })
          .execute();

        const patch = rollPosition === 'IN'
          ? { roll_in_no: newRollNo, roll_in_code: newRollCode ?? null }
          : { roll_out_no: newRollNo, roll_out_code: newRollCode ?? null };
        await trx.updateTable('txn.crm_rolling').set(patch).where('order_id', '=', target.order_id as any).execute();
      }
    });
    return this.getOrder(batchNumber, userId);
  }

  /**
   * Completed: saved actual weight, else PPC planned weight.
   * In-progress/stoppage: saved actual weight if recorded, else the PPC planned
   * weight of the in-flight order — so "In Progress MT" reflects the work on the
   * machine instead of collapsing to 0 (which made Total MT == Completed MT).
   */
  private static async getOrderProductionWeight(
    orderId: string,
    subProcess: string,
    status: string,
    ppcWeightMt: number,
  ): Promise<number> {
    if (status === 'COMPLETED') {
      return this.resolveOrderWeight(orderId, subProcess, ppcWeightMt);
    }
    const saved = await this.getSavedOrderWeight(orderId, subProcess);
    if (saved > 0) return saved;
    return ppcWeightMt > 0 ? ppcWeightMt : 0;
  }

  static async getSavedOrderWeight(orderId: string, subProcess: string): Promise<number> {
    if (subProcess === 'ROLLING') {
      const r = await db.selectFrom('txn.crm_rolling')
        .select('actual_weight_mt')
        .where('order_id', '=', orderId)
        .executeTakeFirst();
      const wt = r?.actual_weight_mt != null ? Number(r.actual_weight_mt) : 0;
      return wt > 0 ? wt : 0;
    }
    const s = await db.selectFrom('txn.crm_skinpass')
      .select('actual_weight_mt')
      .where('order_id', '=', orderId)
      .executeTakeFirst();
    const wt = s?.actual_weight_mt != null ? Number(s.actual_weight_mt) : 0;
    return wt > 0 ? wt : 0;
  }

  /**
   * Orders attributed to a shift.
   *
   * Single source of truth: an order belongs to exactly one shift — its own
   * `crm6_order.shift_log_id`. We intentionally do NOT fall back to matching the
   * planned `ppc_batch.plan_date`/`shift_code`, because a backlog order produced
   * today is re-attributed (moved) to today's shift at production start. Matching
   * on the planned date as well would count such an order under both the planned
   * shift and the production shift (double counting).
   */
  private static async listShiftProductionOrders(
    shiftLogId: string | string[],
    machineFilter?: string | string[],
  ) {
    const machineCodes = machineFilter == null
      ? null
      : Array.isArray(machineFilter) ? machineFilter : [machineFilter];
    const logIds = Array.isArray(shiftLogId) ? shiftLogId : [shiftLogId];
    if (logIds.length === 0) return [];

    let query = db
      .selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([
        'o.order_id',
        'o.batch_number',
        'o.status',
        'o.sub_process',
        'o.customer_name',
        'o.coil_no',
        'o.prod_start_at',
        'o.prod_end_at',
        'o.prod_duration_min',
        'o.combined_group_id',
        'o.ppc_weight_mt',
        'pb.ppc_weight_mt as batch_ppc_weight_mt',
        'pb.machine_code',
      ])
      .where('o.shift_log_id', 'in', logIds)
      .where('o.status', '!=', 'CANCELLED')
      .orderBy(sql`o.combined_group_id NULLS LAST`)
      .orderBy('o.prod_start_at', 'asc')
      .orderBy('o.batch_number', 'asc');

    if (machineCodes && machineCodes.length > 0) {
      query = machineCodes.length === 1
        ? query.where('pb.machine_code', '=', machineCodes[0])
        : query.where('pb.machine_code', 'in', machineCodes);
    }

    const rows = await query.execute();

    const seen = new Set<string>();
    return rows.filter((r) => {
      const id = String(r.order_id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  static async resolveOrderWeight(orderId: string, subProcess: string, ppcWeight: number): Promise<number> {
    if (subProcess === 'ROLLING') {
      const r = await db.selectFrom('txn.crm_rolling')
        .select('actual_weight_mt')
        .where('order_id', '=', orderId)
        .executeTakeFirst();
      return r?.actual_weight_mt ? Number(r.actual_weight_mt) : ppcWeight;
    }
    const s = await db.selectFrom('txn.crm_skinpass')
      .select('actual_weight_mt')
      .where('order_id', '=', orderId)
      .executeTakeFirst();
    return s?.actual_weight_mt ? Number(s.actual_weight_mt) : ppcWeight;
  }

  static async getShiftSummary(
    shiftLogId: string | string[],
    machineFilter?: string | string[],
  ): Promise<SixHiShiftSummary> {
    const logIds = Array.isArray(shiftLogId)
      ? shiftLogId
      : await this.expandSiblingShiftLogIds(shiftLogId);
    const primaryId = logIds[0] ?? (Array.isArray(shiftLogId) ? '' : shiftLogId);
    const shiftOrders = primaryId
      ? await this.listShiftProductionOrders(logIds.length > 0 ? logIds : [primaryId], machineFilter)
      : [];

    let completedRolling = 0;
    let completedReroll = 0;
    let completedSkinpass = 0;
    let inProgressRolling = 0;
    let inProgressReroll = 0;
    let inProgressSkinpass = 0;
    // Planned (PPC) weight of the orders COMPLETED this shift — the real "Target MT done".
    let targetCompletedMt = 0;
    const completedOrders: SixHiShiftSummary['completedOrders'] = [];

    const addWeight = (subProcess: string, wt: number, bucket: 'completed' | 'inProgress') => {
      if (subProcess === 'ROLLING') {
        if (bucket === 'completed') completedRolling += wt;
        else inProgressRolling += wt;
      } else if (bucket === 'completed') {
        completedSkinpass += wt;
      } else {
        inProgressSkinpass += wt;
      }
    };

    const rollingOrderIds = shiftOrders
      .filter((o) => o.sub_process === 'ROLLING')
      .map((o) => o.order_id);
    const rerollByOrderId = new Map<string, boolean>();
    if (rollingOrderIds.length > 0) {
      const rerollRows = await db
        .selectFrom('txn.crm_rolling')
        .select(['order_id', 'rerolling'])
        .where('order_id', 'in', rollingOrderIds)
        .execute();
      for (const r of rerollRows) {
        rerollByOrderId.set(String(r.order_id), !!r.rerolling);
      }
    }

    for (const o of shiftOrders) {
      const ppcWt = Number(o.ppc_weight_mt ?? o.batch_ppc_weight_mt ?? 0);
      const wt = await this.getOrderProductionWeight(
        String(o.order_id),
        o.sub_process,
        o.status,
        ppcWt,
      );
      if (o.status === 'COMPLETED') {
        completedOrders.push({
          batchNumber: o.batch_number,
          subProcess: o.sub_process as SixHiSubProcess,
          customer: o.customer_name,
          weightMt: wt,
          durationMin: o.prod_duration_min ?? undefined,
          machineCode: o.machine_code ? String(o.machine_code).toUpperCase() : undefined,
          combinedGroupId: o.combined_group_id ? String(o.combined_group_id) : undefined,
          coilNo: o.coil_no ?? undefined,
          startAt: o.prod_start_at?.toISOString(),
          endAt: o.prod_end_at?.toISOString(),
        });
        targetCompletedMt += ppcWt;
        addWeight(o.sub_process, wt, 'completed');
        if (o.sub_process === 'ROLLING' && wt > 0 && rerollByOrderId.get(String(o.order_id))) {
          completedReroll += wt;
        }
      } else if (o.status === 'IN_PROGRESS' || o.status === 'STOPPAGE') {
        if (wt <= 0) continue;
        addWeight(o.sub_process, wt, 'inProgress');
        if (o.sub_process === 'ROLLING' && rerollByOrderId.get(String(o.order_id))) {
          inProgressReroll += wt;
        }
      }
    }

    const totalRolling = completedRolling + inProgressRolling;
    const totalReroll = completedReroll + inProgressReroll;
    const totalSkinpass = completedSkinpass + inProgressSkinpass;
    const completedProdMt = completedRolling + completedSkinpass;
    const inProgressProdMt = inProgressRolling + inProgressSkinpass;

    const saved = await db.selectFrom('txn.crm_shift_summary')
      .selectAll()
      .where('shift_log_id', '=', primaryId)
      .executeTakeFirst();

    const { ShiftAttributionService } = await import('./ShiftAttributionService');
    const machineCode = Array.isArray(machineFilter) ? machineFilter[0] : machineFilter;
    const metrics = await ShiftAttributionService.getShiftMetrics(primaryId, machineCode);

    return {
      shiftLogId: primaryId,
      totalProdMt: totalRolling + totalSkinpass,
      completedProdMt,
      inProgressProdMt,
      targetCompletedMt,
      totalRollingMt: totalRolling,
      totalRerollMt: totalReroll,
      totalSkinpassMt: totalSkinpass,
      scrapKg: saved?.scrap_kg != null ? Number(saved.scrap_kg) : undefined,
      coolantTempDegC: saved?.coolant_temp_degc != null ? Number(saved.coolant_temp_degc) : undefined,
      coolantPressKgCm2: saved?.coolant_press_kgcm2 != null ? Number(saved.coolant_press_kgcm2) : undefined,
      completedOrders,
      totalStoppageMinutes: metrics.totalStoppageMinutes,
      totalBreakdownMinutes: metrics.totalBreakdownMinutes,
      machineUtilizationPct: metrics.machineUtilizationPct,
      ordersInProgress: metrics.ordersInProgress,
    };
  }

  static async saveShiftSummary(
    shiftLogId: string,
    scrapKg: number | undefined,
    coolantTempDegC: number | undefined,
    coolantPressKgCm2: number | undefined,
    userId: number,
  ) {
    await assertCrm6ScrapKg(shiftLogId, scrapKg);
    await assertShiftLogRuntimeAccounting(shiftLogId);
    const summary = await this.getShiftSummary(shiftLogId);
    // Merge: undefined means "keep existing in-shift readings" (handover blank must not wipe §13 B3).
    const existing = await db
      .selectFrom('txn.crm_shift_summary')
      .select(['scrap_kg', 'coolant_temp_degc', 'coolant_press_kgcm2'])
      .where('shift_log_id', '=', shiftLogId as any)
      .executeTakeFirst();
    const nextScrap =
      scrapKg !== undefined
        ? scrapKg
        : existing?.scrap_kg != null
          ? Number(existing.scrap_kg)
          : null;
    const nextTemp =
      coolantTempDegC !== undefined
        ? coolantTempDegC
        : existing?.coolant_temp_degc != null
          ? Number(existing.coolant_temp_degc)
          : null;
    const nextPress =
      coolantPressKgCm2 !== undefined
        ? coolantPressKgCm2
        : existing?.coolant_press_kgcm2 != null
          ? Number(existing.coolant_press_kgcm2)
          : null;

    await db.insertInto('txn.crm_shift_summary')
      .values({
        shift_log_id: shiftLogId,
        total_prod_mt: summary.totalProdMt,
        total_rolling_mt: summary.totalRollingMt,
        total_reroll_mt: summary.totalRerollMt,
        total_skinpass_mt: summary.totalSkinpassMt,
        scrap_kg: nextScrap,
        coolant_temp_degc: nextTemp,
        coolant_press_kgcm2: nextPress,
        submitted_at: new Date(),
        submitted_by: userId,
      })
      .onConflict((oc) => oc.column('shift_log_id').doUpdateSet({
        total_prod_mt: summary.totalProdMt,
        total_rolling_mt: summary.totalRollingMt,
        total_reroll_mt: summary.totalRerollMt,
        total_skinpass_mt: summary.totalSkinpassMt,
        scrap_kg: nextScrap,
        coolant_temp_degc: nextTemp,
        coolant_press_kgcm2: nextPress,
        submitted_at: new Date(),
        submitted_by: userId,
      }))
      .execute();
    await this.syncShiftProductionCache(shiftLogId);
    return this.getShiftSummary(shiftLogId);
  }

  static async getProducedMt(shiftLogId: string): Promise<number> {
    const summary = await this.getShiftSummary(shiftLogId);
    return summary.totalProdMt;
  }

  static async resolveShiftLogIdForPlan(planDate: string | Date, shiftCode: string): Promise<string | null> {
    const processId = await this.getProcessId();
    const resolved = await ShiftDetectionService.resolveShift({
      planDate,
      shiftCode,
      processId,
    });
    return resolved.shiftLogId;
  }

  /**
   * All shift_log rows for the same process/date/shift (every mill_type sibling).
   * MH completed counts used to pin to one mill_type=null id and miss orders on
   * mill-specific siblings created for shift review.
   */
  static async expandSiblingShiftLogIds(shiftLogId: string): Promise<string[]> {
    const shiftRow = await db.selectFrom('txn.shift_log')
      .select(['prod_date', 'shift_code', 'process_id'])
      .where('shift_log_id', '=', shiftLogId)
      .executeTakeFirst();
    if (!shiftRow?.prod_date || !shiftRow.shift_code) return [shiftLogId];

    const siblings = await db.selectFrom('txn.shift_log')
      .select('shift_log_id')
      .where('process_id', '=', shiftRow.process_id)
      .where('prod_date', '=', shiftRow.prod_date)
      .where('shift_code', '=', shiftRow.shift_code)
      .execute();
    const ids = siblings.map((row) => String(row.shift_log_id));
    return ids.length > 0 ? ids : [shiftLogId];
  }

  static async resolveShiftLogIdsForPlan(planDate: string | Date, shiftCode: string): Promise<string[]> {
    const primary = await this.resolveShiftLogIdForPlan(planDate, shiftCode);
    if (!primary) return [];
    return this.expandSiblingShiftLogIds(primary);
  }

  static async resolveShiftLogIdForOrder(orderId: string): Promise<string | null> {
    try {
      const resolved = await ShiftDetectionService.resolveShift({ orderId });
      return resolved.shiftLogId;
    } catch {
      return null;
    }
  }

  /** Keep txn.shift_log.total_prod_mt in sync with live 6HI production totals. */
  static async syncShiftProductionCache(shiftLogId: string): Promise<number> {
    const summary = await this.getShiftSummary(shiftLogId);
    await db.updateTable('txn.shift_log')
      .set({ total_prod_mt: summary.totalProdMt })
      .where('shift_log_id', '=', shiftLogId)
      .execute();
    return summary.totalProdMt;
  }

  static async refreshShiftProductionFromOrder(orderId: string): Promise<void> {
    const shiftLogId = await this.resolveShiftLogIdForOrder(orderId);
    if (!shiftLogId) return;
    await this.syncShiftProductionCache(shiftLogId).catch((err) => {
      console.error('[SixHi] syncShiftProductionCache failed:', err);
    });
  }
}
