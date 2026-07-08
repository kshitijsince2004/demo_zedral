import { sql } from 'kysely';
import type {
  SixHiOrderDetail,
  SixHiQueueCard,
  SixHiRollingData,
  SixHiShiftSummary,
  SixHiSkinPassData,
  SixHiSubProcess,
} from '@m1/shared-validation';
import { db } from '../db';
import { getTenantId } from '../context';
import { ShiftLogService } from './shiftLogService';
import { ShiftDetectionService } from './ShiftDetectionService';
import { ProcessRouteService } from './ProcessRouteService';
import { MachineRegistryService } from './MachineRegistryService';
import { MachineStateEventService } from './MachineStateEventService';
import {
  ensureOrderMachineTransferTable,
  loadRecentOrderMachineTransfersGlobal,
  recordOrderMachineTransfer,
} from './orderMachineTransferAudit';
import {
  assertCanStartOrderStoppage,
  validateOrderStoppageInterval,
  validateOrderStoppageStart,
} from '../validation/orderStoppageValidation';
import {
  assertCrm6DefectQuantities,
  assertCrm6OutputWeight,
  assertCrm6ScrapKg,
  assertOrderRuntimeAccounting,
  assertShiftLogRuntimeAccounting,
} from '../validation/crm6ProductionValidation';


const SIX_HI_PROCESS_CODE = '6HI';

function mapDestination(raw: string | null): 'REWINDING' | 'ANNEALING' {
  return raw === 'REWINDING' ? 'REWINDING' : 'ANNEALING';
}

function mapRollFinish(raw: string | null): 'MATT' | 'BRIGHT' | 'LOW_MATT' {
  if (raw === 'BRIGHT') return 'BRIGHT';
  if (raw === 'LOW_MATT') return 'LOW_MATT';
  return 'MATT';
}

export class SixHiService {
  static async getProcessId(): Promise<number> {
    const p = await db.selectFrom('master.process').select('process_id').where('code', '=', SIX_HI_PROCESS_CODE).executeTakeFirst();
    if (!p) throw new Error('6HI process not configured');
    return p.process_id;
  }

  static async ensureActiveShiftLog(userId: number, planDate?: Date, shiftCode?: string): Promise<string> {
    const processId = await this.getProcessId();
    const prodDate = planDate ?? new Date();
    const shift = shiftCode ?? 'B';

    const existing = await db.selectFrom('txn.shift_log')
      .select('shift_log_id')
      .where('process_id', '=', processId)
      .where('prod_date', '=', prodDate)
      .where('shift_code', '=', shift)
      .executeTakeFirst();

    if (existing) {
      return String(existing.shift_log_id);
    }

    const id = await ShiftLogService.create({
      processId,
      productionDate: prodDate,
      shiftCode: shift,
      supervisorId: userId,
    });
    return String(id);
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
   * The current active shift is resolved via the existing ShiftDetectionService
   * (machine session → override → clock), i.e. the single source of truth for "now".
   *
   * @returns the authoritative shift_log_id the order is attributed to, or null.
   */
  static async reattributeOrderToActiveShift(
    orderId: string | number,
    userId: number,
    machineCode?: string,
  ): Promise<string | null> {
    const id = String(orderId);
    const current = await db.selectFrom('txn.crm6_order')
      .select(['shift_log_id'])
      .where('order_id', '=', id)
      .executeTakeFirst();
    if (!current) return null;

    const detected = await ShiftDetectionService.getCurrentShift({ userId, machineCode });
    const prodDate = this.toPlanDate(detected.prodDate);
    const shiftCode = detected.shiftCode.toUpperCase();

    const targetShiftLogId = await this.ensureActiveShiftLog(userId, prodDate, shiftCode);
    const oldShiftLogId = current.shift_log_id != null ? String(current.shift_log_id) : null;

    // No-op when the order is already attributed to the active shift (normal same-shift orders).
    if (oldShiftLogId === String(targetShiftLogId)) {
      return String(targetShiftLogId);
    }

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('txn.crm6_order')
        .set({
          shift_log_id: targetShiftLogId,
          prod_date: prodDate,
          production_day: prodDate,
          shift_code: shiftCode,
          updated_at: new Date(),
        } as any)
        .where('order_id', '=', id)
        .execute();

      await trx.updateTable('txn.crm6_rolling')
        .set({ shift_code: shiftCode, prod_date: prodDate } as any)
        .where('order_id', '=', id)
        .execute();
    });

    // Machine-centric attribution slices (runtime/utilization) follow the order too.
    // Slices are only created at shift-boundary processing, so at production start there
    // are normally none; the .catch guards the rare (order, shift_log, machine) collision.
    await db.updateTable('txn.order_shift_attribution')
      .set({ shift_log_id: targetShiftLogId, shift_code: shiftCode, prod_date: prodDate } as any)
      .where('order_id', '=', id)
      .execute()
      .catch((err) => console.error('[SixHi] reattribute attribution slice failed:', err));

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
    const stops = await db.selectFrom('txn.order_stoppage')
      .select(['start_at', 'end_at', 'duration_min'])
      .where('order_id', '=', id)
      .execute();
    let total = 0;
    for (const s of stops) {
      if (s.duration_min != null) {
        total += s.duration_min;
      } else if (s.end_at) {
        total += Math.round((s.end_at.getTime() - s.start_at.getTime()) / 60000);
      } else {
        total += Math.round((asOf.getTime() - s.start_at.getTime()) / 60000);
      }
    }
    return total;
  }

  private static async assertNoOpenStoppage(orderId: number | string): Promise<void> {
    const id = String(orderId);
    const open = await db.selectFrom('txn.order_stoppage')
      .select(db.fn.count('stoppage_id').as('c'))
      .where('order_id', '=', id)
      .where('end_at', 'is', null)
      .executeTakeFirst();
    if (Number(open?.c ?? 0) > 0) {
      throw new Error('End the active stoppage before continuing');
    }
  }

  static formatPlanDate(value: Date | string): string {
    const d = value instanceof Date ? value : this.toPlanDate(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Parse YYYY-MM-DD as a local calendar date (avoids UTC timezone drift). */
  static toPlanDate(value: string | Date): Date {
    if (value instanceof Date) return value;
    const raw = String(value).slice(0, 10);
    const [y, m, d] = raw.split('-').map(Number);
    if (!y || !m || !d) return new Date(value);
    return new Date(y, m - 1, d);
  }

  private static async countMachineBatches(
    planDate: string,
    shiftCode: string,
    machineCode: string,
    subProcess?: SixHiSubProcess,
  ): Promise<number> {
    let query = db.selectFrom('planning.ppc_batch')
      .select(db.fn.count('batch_id').as('n'))
      .where('plan_date', '=', this.toPlanDate(planDate))
      .where('shift_code', '=', shiftCode)
      .where('machine_code', '=', machineCode)
      .where('machine_allocated', '=', true);
    if (subProcess) {
      query = query.where('sub_process', '=', subProcess);
    }
    const row = await query.executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  private static async countAllocatedBatches(
    planDate: string,
    shiftCode: string,
    subProcess: SixHiSubProcess,
    machineCode: string,
  ): Promise<number> {
    return this.countMachineBatches(planDate, shiftCode, machineCode, subProcess);
  }

  /** Resolve plan date + shift for multiple machines in a fixed query count. */
  static async resolveMachinePlanContexts(
    planDate: string,
    shiftCode: string,
    machineCodes: string[],
  ): Promise<Map<string, { planDate: string; shiftCode: string }>> {
    const result = new Map<string, { planDate: string; shiftCode: string }>();
    const unique = [...new Set(machineCodes.filter(Boolean))];
    if (unique.length === 0) return result;

    const planDateObj = this.toPlanDate(planDate);

    const exactCounts = await db.selectFrom('planning.ppc_batch')
      .select(['machine_code', db.fn.count('batch_id').as('n')])
      .where('plan_date', '=', planDateObj)
      .where('shift_code', '=', shiftCode)
      .where('machine_code', 'in', unique)
      .where('machine_allocated', '=', true)
      .groupBy('machine_code')
      .execute();

    const unresolved: string[] = [];
    for (const machineCode of unique) {
      const count = Number(exactCounts.find((r) => r.machine_code === machineCode)?.n ?? 0);
      if (count > 0) {
        result.set(machineCode, { planDate, shiftCode });
      } else {
        unresolved.push(machineCode);
      }
    }

    if (unresolved.length === 0) return result;

    const sameDateShifts = await db.selectFrom('planning.ppc_batch')
      .select(['machine_code', 'shift_code', db.fn.count('batch_id').as('n')])
      .where('plan_date', '=', planDateObj)
      .where('machine_code', 'in', unresolved)
      .where('machine_allocated', '=', true)
      .groupBy(['machine_code', 'shift_code'])
      .orderBy('machine_code', 'asc')
      .orderBy('shift_code', 'asc')
      .execute();

    const stillUnresolved: string[] = [];
    for (const machineCode of unresolved) {
      const row = sameDateShifts.find(
        (r) => r.machine_code === machineCode && Number(r.n ?? 0) > 0,
      );
      if (row) {
        result.set(machineCode, { planDate, shiftCode: row.shift_code });
      } else {
        stillUnresolved.push(machineCode);
      }
    }

    if (stillUnresolved.length === 0) return result;

    const latestBatchRows = await db.selectFrom('planning.ppc_batch')
      .select(['machine_code', 'plan_date', 'shift_code'])
      .where('machine_code', 'in', stillUnresolved)
      .where('machine_allocated', '=', true)
      .orderBy('machine_code', 'asc')
      .orderBy('plan_date', 'desc')
      .orderBy('queue_seq', 'asc')
      .execute();

    const seenLatest = new Set<string>();
    for (const row of latestBatchRows) {
      if (seenLatest.has(row.machine_code)) continue;
      seenLatest.add(row.machine_code);
      if (!row.plan_date) continue;
      result.set(row.machine_code, {
        planDate: this.formatPlanDate(row.plan_date),
        shiftCode: row.shift_code,
      });
    }

    for (const machineCode of stillUnresolved) {
      if (!result.has(machineCode)) {
        result.set(machineCode, { planDate, shiftCode });
      }
    }

    return result;
  }

  /** Resolve plan date + shift for a machine (all sub-processes). Used by machine head + operator queue. */
  static async resolveMachinePlanContext(
    planDate: string,
    shiftCode: string,
    machineCode: string,
  ): Promise<{ planDate: string; shiftCode: string }> {
    const contexts = await this.resolveMachinePlanContexts(planDate, shiftCode, [machineCode]);
    return contexts.get(machineCode) ?? { planDate, shiftCode };
  }

  /** Resolve plan date + shift when the UI shift context does not match seeded PPC rows. */
  static async resolveQueueContext(
    planDate: string,
    shiftCode: string,
    subProcess: SixHiSubProcess,
    machineCode: string = '6HI',
  ): Promise<{ planDate: string; shiftCode: string }> {
    const machineCtx = await this.resolveMachinePlanContext(planDate, shiftCode, machineCode);
    if (await this.countAllocatedBatches(machineCtx.planDate, machineCtx.shiftCode, subProcess, machineCode) > 0) {
      return machineCtx;
    }

    if (await this.countAllocatedBatches(planDate, shiftCode, subProcess, machineCode) > 0) {
      return { planDate, shiftCode };
    }

    const sameDateShifts = await db.selectFrom('planning.ppc_batch')
      .select(['shift_code', db.fn.count('batch_id').as('n')])
      .where('plan_date', '=', this.toPlanDate(planDate))
      .where('machine_code', '=', machineCode)
      .where('sub_process', '=', subProcess)
      .where('machine_allocated', '=', true)
      .groupBy('shift_code')
      .orderBy('shift_code', 'asc')
      .execute();
    for (const row of sameDateShifts) {
      if (Number(row.n ?? 0) > 0) {
        return { planDate, shiftCode: row.shift_code };
      }
    }

    const latest = await db.selectFrom('planning.ppc_batch')
      .select(['plan_date', 'shift_code'])
      .where('machine_code', '=', machineCode)
      .where('sub_process', '=', subProcess)
      .where('machine_allocated', '=', true)
      .orderBy('plan_date', 'desc')
      .orderBy('queue_seq', 'asc')
      .limit(1)
      .executeTakeFirst();
    if (latest?.plan_date) {
      return {
        planDate: this.formatPlanDate(latest.plan_date),
        shiftCode: latest.shift_code,
      };
    }
    return machineCtx;
  }

  private static readonly NON_ASSIGNABLE_ORDER_STATUSES = new Set([
    'COMPLETED',
    'REJECTED',
    'IN_PROGRESS',
    'STOPPAGE',
  ]);

  /**
   * Resolve plan date + shift for Order Assignment (unallocated batches).
   * Unlike resolveQueueContext, this considers pending-assignment imports — not only
   * machine_allocated rows used by operator queues.
   */
  static async resolveOrderAssignmentContext(
    planDate: string,
    shiftCode: string,
  ): Promise<{ planDate: string; shiftCode: string }> {
    const planDateObj = this.toPlanDate(planDate);
    const nonAssignable = [...SixHiService.NON_ASSIGNABLE_ORDER_STATUSES];

    const countUnallocated = async (date: string, shift: string): Promise<number> => {
      const row = await db.selectFrom('planning.ppc_batch as pb')
        .leftJoin('txn.crm6_order as o', 'o.batch_id', 'pb.batch_id')
        .select(db.fn.countAll<number>().as('n'))
        .where('pb.plan_date', '=', this.toPlanDate(date))
        .where('pb.shift_code', '=', shift)
        .where('pb.machine_allocated', '=', false)
        .where((eb) => eb.or([
          eb('o.status', 'is', null),
          eb('o.status', 'not in', nonAssignable),
        ]))
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    };

    if (await countUnallocated(planDate, shiftCode) > 0) {
      return { planDate, shiftCode };
    }

    const sameDateShifts = await db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm6_order as o', 'o.batch_id', 'pb.batch_id')
      .select(['pb.shift_code', db.fn.countAll<number>().as('n')])
      .where('pb.plan_date', '=', planDateObj)
      .where('pb.machine_allocated', '=', false)
      .where((eb) => eb.or([
        eb('o.status', 'is', null),
        eb('o.status', 'not in', nonAssignable),
      ]))
      .groupBy('pb.shift_code')
      .orderBy('pb.shift_code', 'asc')
      .execute();
    for (const row of sameDateShifts) {
      if (Number(row.n ?? 0) > 0) {
        return { planDate, shiftCode: row.shift_code };
      }
    }

    const latest = await db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm6_order as o', 'o.batch_id', 'pb.batch_id')
      .select(['pb.plan_date', 'pb.shift_code'])
      .where('pb.machine_allocated', '=', false)
      .where((eb) => eb.or([
        eb('o.status', 'is', null),
        eb('o.status', 'not in', nonAssignable),
      ]))
      .orderBy('pb.plan_date', 'desc')
      .orderBy('pb.shift_code', 'asc')
      .orderBy('pb.batch_number', 'asc')
      .limit(1)
      .executeTakeFirst();
    if (latest?.plan_date) {
      return {
        planDate: this.formatPlanDate(latest.plan_date),
        shiftCode: latest.shift_code,
      };
    }

    return { planDate, shiftCode };
  }

  /** @deprecated Use resolveQueueContext */
  static async resolveQueueDate(planDate: string, shiftCode: string, subProcess: SixHiSubProcess): Promise<string> {
    const ctx = await this.resolveQueueContext(planDate, shiftCode, subProcess);
    return ctx.planDate;
  }

  private static readonly INCOMPLETE_ORDER_STATUSES = [
    'PENDING',
    'PREPARING',
    'IN_PROGRESS',
    'STOPPAGE',
  ] as const;

  /** Shift codes earlier in the same production day (A→B→C cycle). */
  private static earlierShiftCodesOnSameDay(shiftCode: string): string[] {
    const order = ['A', 'B', 'C'];
    const idx = order.indexOf(shiftCode.toUpperCase());
    if (idx <= 0) return [];
    return order.slice(0, idx);
  }

  private static async resolveShiftForViewDate(
    planDate: string,
    shiftCode: string,
    subProcess: SixHiSubProcess,
    machineCode: string,
  ): Promise<string> {
    const countForShift = async (shift: string): Promise<number> => {
      const row = await db.selectFrom('planning.ppc_batch')
        .select(db.fn.countAll<number>().as('n'))
        .where('plan_date', '=', this.toPlanDate(planDate))
        .where('shift_code', '=', shift)
        .where('sub_process', '=', subProcess)
        .where((eb) => eb.or([
          eb.and([
            eb('machine_code', '=', machineCode),
            eb('machine_allocated', '=', true),
          ]),
          eb('machine_allocated', '=', false),
        ]))
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    };

    if (await countForShift(shiftCode) > 0) return shiftCode;

    const sameDateShifts = await db.selectFrom('planning.ppc_batch')
      .select(['shift_code', db.fn.countAll<number>().as('n')])
      .where('plan_date', '=', this.toPlanDate(planDate))
      .where('sub_process', '=', subProcess)
      .groupBy('shift_code')
      .orderBy('shift_code', 'asc')
      .execute();
    for (const row of sameDateShifts) {
      if (Number(row.n ?? 0) > 0) return row.shift_code;
    }
    return shiftCode;
  }

  private static async buildQueueCard(
    b: {
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
    },
    subProcess: SixHiSubProcess,
    queuePosition: number,
    options?: { isBacklog?: boolean },
  ): Promise<SixHiQueueCard> {
    const order = await db.selectFrom('txn.crm6_order')
      .selectAll()
      .where('batch_id', '=', String(b.batch_id))
      .executeTakeFirst();

    let activeStoppageCategory: string | undefined;
    let prepReady = false;
    if (order) {
      const openStop = await db.selectFrom('txn.order_stoppage as os')
        .innerJoin('master.stoppage_category as sc', 'os.category_code', 'sc.category_code')
        .select(['sc.label'])
        .where('os.order_id', '=', order.order_id)
        .where('os.end_at', 'is', null)
        .executeTakeFirst();
      activeStoppageCategory = openStop?.label;

      if (order.status === 'PENDING' || order.status === 'PREPARING') {
        if (subProcess === 'ROLLING') {
          const rolling = await db.selectFrom('txn.crm6_rolling')
            .select(['actual_weight_mt', 'total_passes'])
            .where('order_id', '=', order.order_id)
            .executeTakeFirst();
          const passCount = await db.selectFrom('txn.crm6_rolling_pass')
            .select(sql<number>`count(*)::int`.as('n'))
            .where('order_id', '=', order.order_id)
            .executeTakeFirst();
          prepReady = !!(rolling?.actual_weight_mt || (passCount?.n ?? 0) > 0 || (rolling?.total_passes ?? 0) > 0);
        } else {
          const sp = await db.selectFrom('txn.crm6_skinpass')
            .select(['output_thk_mm', 'ann_hard', 'operating_mode'])
            .where('order_id', '=', order.order_id)
            .executeTakeFirst();
          prepReady = !!(sp?.output_thk_mm || sp?.ann_hard || sp?.operating_mode);
        }
      }
    }

    const inputThk = Number(b.input_thk_mm ?? b.ppc_thk_mm);
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

  static async getQueue(
    subProcess: SixHiSubProcess,
    planDate: string,
    shiftCode: string,
    machineCode: string = '6HI',
  ): Promise<{
    planDate: string;
    shiftCode: string;
    machineCode: string;
    queue: SixHiQueueCard[];
    pendingAllocation: SixHiQueueCard[];
    backlog: SixHiQueueCard[];
  }> {
    const viewDate = planDate;
    const effectiveShift = await this.resolveShiftForViewDate(
      viewDate,
      shiftCode,
      subProcess,
      machineCode,
    );
    const viewDateObj = this.toPlanDate(viewDate);
    const incomplete = [...SixHiService.INCOMPLETE_ORDER_STATUSES];

    const batches = await db.selectFrom('planning.ppc_batch as pb')
      .selectAll('pb')
      .where('pb.plan_date', '=', viewDateObj)
      .where('pb.shift_code', '=', effectiveShift)
      .where('pb.machine_code', '=', machineCode)
      .where('pb.sub_process', '=', subProcess)
      .where('pb.machine_allocated', '=', true)
      .orderBy('pb.queue_seq', 'asc')
      .orderBy('pb.batch_number', 'asc')
      .execute();

    const pendingBatches = await db.selectFrom('planning.ppc_batch as pb')
      .selectAll('pb')
      .where('pb.plan_date', '=', viewDateObj)
      .where('pb.shift_code', '=', effectiveShift)
      .where('pb.sub_process', '=', subProcess)
      .where('pb.machine_allocated', '=', false)
      .orderBy('pb.queue_seq', 'asc')
      .orderBy('pb.batch_number', 'asc')
      .execute();

    const earlierSameDayShifts = this.earlierShiftCodesOnSameDay(effectiveShift);
    const backlogBatches = await db.selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm6_order as o', 'o.batch_id', 'pb.batch_id')
      .selectAll('pb')
      .where((eb) => {
        const priorDay = eb('pb.plan_date', '<', viewDateObj);
        if (earlierSameDayShifts.length === 0) return priorDay;
        return eb.or([
          priorDay,
          eb.and([
            eb('pb.plan_date', '=', viewDateObj),
            eb('pb.shift_code', 'in', earlierSameDayShifts),
          ]),
        ]);
      })
      .where('pb.sub_process', '=', subProcess)
      .where((eb) => eb.or([
        eb.and([
          eb('pb.machine_code', '=', machineCode),
          eb('pb.machine_allocated', '=', true),
        ]),
        eb('pb.machine_allocated', '=', false),
      ]))
      .where((eb) => eb.or([
        eb('o.status', 'is', null),
        eb('o.status', 'in', incomplete),
        eb.and([
          eb('o.status', '=', 'COMPLETED'),
          sql<boolean>`o.prod_end_at >= ${viewDateObj}::date`,
          sql<boolean>`o.prod_end_at < ${viewDateObj}::date + interval '32 hours'`,
        ]),
      ]))
      .orderBy('pb.plan_date', 'asc')
      .orderBy('pb.queue_seq', 'asc')
      .orderBy('pb.batch_number', 'asc')
      .execute();

    const cards: SixHiQueueCard[] = [];
    let pos = 0;
    for (const b of batches) {
      pos++;
      cards.push(await this.buildQueueCard(b, subProcess, pos));
    }

    const pendingAllocation: SixHiQueueCard[] = [];
    let pendingPos = 0;
    for (const b of pendingBatches) {
      pendingPos++;
      pendingAllocation.push(await this.buildQueueCard(b, subProcess, pendingPos));
    }

    const backlog: SixHiQueueCard[] = [];
    let backlogPos = 0;
    for (const b of backlogBatches) {
      backlogPos++;
      backlog.push(await this.buildQueueCard(b, subProcess, backlogPos, { isBacklog: true }));
    }

    return {
      planDate: viewDate,
      shiftCode: effectiveShift,
      machineCode,
      queue: cards,
      pendingAllocation,
      backlog,
    };
  }

  static async allocateMachine(
    batchNumber: string,
    machineCode: string,
    userId: number,
    options?: { reason?: string; transferType?: 'SINGLE' | 'BULK' },
  ): Promise<SixHiOrderDetail> {
    const batch = await db.selectFrom('planning.ppc_batch')
      .selectAll()
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch) throw new Error(`Batch not found: ${batchNumber}`);

    const subProcess = batch.sub_process as SixHiSubProcess;
    const machine = await MachineRegistryService.assertMachineForSubProcess(subProcess, machineCode);

    const sourceMachine = batch.machine_code;
    const alreadyOnTarget = (batch.machine_allocated ?? true) && sourceMachine === machine;
    if (alreadyOnTarget) {
      throw new Error(`Order is already assigned to ${machine}`);
    }

    const order = await db.selectFrom('txn.crm6_order')
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
        .where('plan_date', '=', batch.plan_date)
        .where('shift_code', '=', batch.shift_code)
        .where('machine_code', '=', machine)
        .where('sub_process', '=', subProcess)
        .where('machine_allocated', '=', true)
        .executeTakeFirst();
      const queueSeq = (Number(maxSeq?.max_seq) || 0) + 1;

      await trx.updateTable('planning.ppc_batch')
        .set({
          machine_code: machine,
          machine_allocated: true,
          queue_seq: queueSeq,
        })
        .where('batch_id', '=', batch.batch_id)
        .execute();

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

      await trx.updateTable('txn.crm6_order')
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
        await this.allocateMachine(batchNumber, resolvedTarget, userId, { reason, transferType });
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
      .leftJoin('txn.crm6_order as o', 'o.batch_id', 'pb.batch_id')
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
      const crmOrder = await db.selectFrom('txn.crm6_order')
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
          .leftJoin('txn.crm6_order as o', 'o.batch_id', 'pb.batch_id')
          .select(db.fn.countAll<number>().as('cnt'))
          .where('pb.machine_code', '=', code)
          .where('pb.machine_allocated', '=', true)
          .where((eb) => eb.or([
            eb('o.status', 'is', null),
            eb('o.status', 'in', activeStatuses),
          ]))
          .executeTakeFirst();

        const active = await db.selectFrom('txn.crm6_order as o')
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

    const existing = await db.selectFrom('txn.crm6_order')
      .select('order_id')
      .where('batch_id', '=', batch.batch_id)
      .executeTakeFirst();
    if (existing) return String(existing.order_id);

    const shiftLogId = await this.ensureActiveShiftLog(
      userId,
      batch.plan_date,
      batch.shift_code,
    );

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

    const order = await db.insertInto('txn.crm6_order')
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
        production_day: batch.plan_date,
        shift_code: batch.shift_code,
        prod_date: batch.plan_date,
      } as any)
      .returning('order_id')
      .executeTakeFirstOrThrow();

    if (batch.sub_process === 'ROLLING') {
      await db.insertInto('txn.crm6_rolling')
        .values({
          order_id: order.order_id,
          destination: batch.destination ?? 'ANNEALING',
          roll_finish: batch.roll_finish ?? 'MATT',
          rerolling: batch.ppc_reroll_flag ?? false,
          associate_rw: batch.destination === 'REWINDING' ? 'R/W' : null,
          shift_code: batch.shift_code,
          prod_date: batch.plan_date,
        } as any)
        .execute();
    } else {
      await db.insertInto('txn.crm6_skinpass').values({ order_id: order.order_id }).execute();
    }

    return String(order.order_id);
  }

  static async getOrder(batchNumber: string, userId: number): Promise<SixHiOrderDetail> {
    await this.ensureOrder(batchNumber, userId);
    const order = await db.selectFrom('txn.crm6_order')
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

    const stoppages = await db.selectFrom('txn.order_stoppage as os')
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
      await db.updateTable('txn.crm6_order')
        .set({ status: resolvedStatus, updated_at: new Date() })
        .where('order_id', '=', order.order_id)
        .execute();
    }

    let rolling: SixHiRollingData | undefined;
    let skinPass: SixHiSkinPassData | undefined;

    if (order.sub_process === 'ROLLING') {
      const r = await db.selectFrom('txn.crm6_rolling').selectAll().where('order_id', '=', order.order_id).executeTakeFirst();
      const passes = await db.selectFrom('txn.crm6_rolling_pass')
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
        };
      }
    } else {
      const s = await db.selectFrom('txn.crm6_skinpass').selectAll().where('order_id', '=', order.order_id).executeTakeFirst();
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

    const inputThk = Number(order.input_thk_mm ?? order.ppc_thk_mm);
    const targetThk = Number(order.ppc_thk_mm);
    const finishThk = ppcBatch?.finish_thk_mm != null ? Number(ppcBatch.finish_thk_mm) : undefined;

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
      machineCode: ppcBatch?.machine_code,
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
      prodDurationMin: order.prod_duration_min ?? undefined,
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
    };
  }

  static async findActiveMachineOrder(
    machineCode: string = '6HI',
  ): Promise<{ batchNumber: string; status: string; subProcess: SixHiSubProcess } | null> {
    const active = await db.selectFrom('txn.crm6_order as o')
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
      .select(['machine_code', 'machine_allocated', 'shift_code'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (!batch?.machine_allocated) {
      throw new Error('Assign a production machine before starting');
    }
    const machineCode = batch?.machine_code ?? '6HI';
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);

    const active = await this.findActiveMachineOrder(machineCode);
    if (active && active.batchNumber !== batchNumber) {
      throw new Error(`ACTIVE_ORDER_CONFLICT:${active.batchNumber}`);
    }

    const orderRow = await db.selectFrom('txn.crm6_order')
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
      await db.updateTable('txn.crm6_order')
        .set({ status: 'IN_PROGRESS', updated_at: new Date() })
        .where('order_id', '=', orderId)
        .execute();
      const batch = await db.selectFrom('planning.ppc_batch')
        .select(['machine_code', 'shift_code'])
        .where('batch_number', '=', batchNumber)
        .executeTakeFirst();
      if (batch) {
        await MachineStateEventService.recordEvent(batch.machine_code, 'RUNNING_STARTED', {
          orderId,
          batchNumber,
          operatorId: userId,
          shiftCode: batch.shift_code,
        }).catch((err) => console.error('[MachineStateEvent] RUNNING_STARTED failed:', err));
      }
      return this.getOrder(batchNumber, userId);
    }
    if (status !== 'PENDING' && status !== 'PREPARING') {
      throw new Error('Only pending or preparing orders can be started');
    }

    await db.updateTable('txn.crm6_order')
      .set({ 
        status: 'IN_PROGRESS', 
        prod_start_at: orderRow?.prod_start_at ?? new Date(), 
        updated_at: new Date() 
      })
      .where('order_id', '=', orderId)
      .execute();
    const coilNo = orderRow?.coil_no ?? (await db.selectFrom('txn.crm6_order').select('coil_no').where('order_id', '=', orderId).executeTakeFirstOrThrow()).coil_no;
    await db.updateTable('coil.coil')
      .set({ status: 'IN_PROCESS' })
      .where('coil_no', '=', coilNo)
      .execute();

    // Production has begun: attribute the order to the operator's actual active shift.
    // Backlog orders planned for a previous shift are moved to today's shift here.
    await this.reattributeOrderToActiveShift(orderId, userId, machineCode);

    // Persist machine state event: IDLE_ENDED → RUNNING_STARTED
    MachineStateEventService.recordEvent(machineCode, 'RUNNING_STARTED', {
      orderId,
      batchNumber,
      operatorId: userId,
      shiftCode: batch.shift_code,
    }).catch((err) => console.error('[MachineStateEvent] RUNNING_STARTED failed:', err));

    return this.getOrder(batchNumber, userId);
  }

  static async startCombinedProduction(batchNumbers: string[], userId: number): Promise<SixHiOrderDetail[]> {
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
    const finalThk = (row: typeof first) => String(row.finish_thk_mm ?? row.ppc_thk_mm);
    const normalized = (value: string | null | undefined) => value?.trim() || '';
    const baseKey = [
      first.coil_no,
      normalized(first.slit_id),
      normalized(first.roll_finish),
      finalThk(first),
    ].join('|');

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
      const key = [
        batch.coil_no,
        normalized(batch.slit_id),
        normalized(batch.roll_finish),
        finalThk(batch),
      ].join('|');
      if (key !== baseKey) {
        throw new Error('Selected orders must share Mother Coil, Select ID, Finish, and Final Output Thickness');
      }
    }

    const machineCode = first.machine_code ?? '6HI';
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);

    const active = await this.findActiveMachineOrder(machineCode);
    if (active && !uniqueBatchNumbers.includes(active.batchNumber)) {
      throw new Error(`ACTIVE_ORDER_CONFLICT:${active.batchNumber}`);
    }

    const startedAt = new Date();
    for (const batchNumber of uniqueBatchNumbers) {
      const orderRow = await db.selectFrom('txn.crm6_order')
        .select(['order_id', 'status', 'coil_no'])
        .where('batch_number', '=', batchNumber)
        .executeTakeFirst();
      const orderId = orderRow?.order_id ?? await this.ensureOrder(batchNumber, userId);
      const status = orderRow?.status ?? 'PENDING';

      if (status === 'IN_PROGRESS') {
        continue;
      }
      if (status !== 'PENDING' && status !== 'PREPARING') {
        throw new Error('Only pending or preparing orders can be started together');
      }

      await db.updateTable('txn.crm6_order')
        .set({ status: 'IN_PROGRESS', prod_start_at: startedAt, updated_at: startedAt })
        .where('order_id', '=', orderId)
        .execute();

      const coilNo = orderRow?.coil_no
        ?? (await db.selectFrom('txn.crm6_order').select('coil_no').where('order_id', '=', orderId).executeTakeFirstOrThrow()).coil_no;
      await db.updateTable('coil.coil')
        .set({ status: 'IN_PROCESS' })
        .where('coil_no', '=', coilNo)
        .execute();

      // Attribute each order to the operator's actual active shift at production start.
      await this.reattributeOrderToActiveShift(orderId, userId, machineCode);

      MachineStateEventService.recordEvent(machineCode, 'RUNNING_STARTED', {
        orderId,
        batchNumber,
        operatorId: userId,
        shiftCode: first.shift_code,
        meta: { combinedRunBatchNumbers: uniqueBatchNumbers },
      }).catch((err) => console.error('[MachineStateEvent] RUNNING_STARTED failed:', err));
    }

    return Promise.all(uniqueBatchNumbers.map((batchNumber) => this.getOrder(batchNumber, userId)));
  }

  static async endProduction(batchNumber: string, userId: number, defectCodes?: string[]) {
    const batchPre = await db.selectFrom('planning.ppc_batch')
      .select(['machine_code', 'shift_code'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    const machineCode = batchPre?.machine_code ?? '6HI';
    const { MachineHandoverService } = await import('./MachineHandoverService');
    await MachineHandoverService.assertProductionAllowed(machineCode, userId);

    const order = await db.selectFrom('txn.crm6_order').selectAll().where('batch_number', '=', batchNumber).executeTakeFirstOrThrow();
    if (order.status !== 'IN_PROGRESS' && order.status !== 'STOPPAGE') {
      throw new Error('Only running orders can be completed');
    }
    await this.assertNoOpenStoppage(order.order_id);

    const endAt = new Date();
    let durationMin: number | null = null;
    if (order.prod_start_at) {
      const totalStoppageMin = await this.totalStoppageMinutes(order.order_id, endAt);
      const wallMin = Math.round((endAt.getTime() - order.prod_start_at.getTime()) / 60000);
      durationMin = Math.max(0, wallMin - totalStoppageMin);
      await assertOrderRuntimeAccounting(order.order_id, durationMin, totalStoppageMin);
    }
    const rolling = await db.selectFrom('txn.crm6_rolling')
      .select(['destination', 'actual_weight_mt', 'final_thk_mm'])
      .where('order_id', '=', order.order_id)
      .executeTakeFirst();
    const skinpass = await db.selectFrom('txn.crm6_skinpass')
      .select(['actual_weight_mt', 'output_thk_mm'])
      .where('order_id', '=', order.order_id)
      .executeTakeFirst();

    const isCompleted = (rolling?.actual_weight_mt != null) || (skinpass?.actual_weight_mt != null);
    const newStatus = isCompleted ? 'COMPLETED' : 'PENDING';

    await db.updateTable('txn.crm6_order')
      .set({
        status: newStatus,
        prod_end_at: endAt,
        prod_duration_min: durationMin,
        updated_at: endAt,
      })
      .where('order_id', '=', order.order_id)
      .execute();

    if (defectCodes && defectCodes.length > 0) {
      await db.insertInto('txn.order_remark')
        .values({
          order_id: order.order_id,
          text: `Minor defects logged during production ${isCompleted ? 'completion' : 'pause'}`,
          defect_codes: JSON.stringify(defectCodes),
          operator_id: userId,
        })
        .execute();
      
      for (const defectCode of defectCodes) {
        MachineStateEventService.recordEvent(machineCode, 'DEFECT_REPORTED', {
          orderId: order.order_id,
          batchNumber,
          operatorId: userId,
          shiftCode: batchPre?.shift_code ?? undefined,
          categoryCode: defectCode,
          reason: `Minor defect logged at ${isCompleted ? 'completion' : 'pause'}`,
        }).catch((err) => console.error('[MachineStateEvent] DEFECT_REPORTED failed:', err));
      }
    }

    if (isCompleted) {
      const batch = await db.selectFrom('planning.ppc_batch')
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
        await db.updateTable('coil.coil')
          .set({ status: 'DONE', next_dest: nextDest })
          .where('coil_no', '=', order.coil_no)
          .execute();
      }
    }

    // Persist machine state event: RUNNING_ENDED → IDLE_STARTED
    const ppcForMachine = await db.selectFrom('planning.ppc_batch')
      .select(['machine_code', 'shift_code'])
      .where('batch_id', '=', order.batch_id)
      .executeTakeFirst();
    if (ppcForMachine) {
      MachineStateEventService.recordEvent(ppcForMachine.machine_code, 'RUNNING_ENDED', {
        orderId: order.order_id,
        batchNumber: order.batch_number,
        operatorId: order.logged_in_user_id ?? undefined,
        shiftCode: ppcForMachine.shift_code,
      }).then(() =>
        MachineStateEventService.recordEvent(ppcForMachine.machine_code, 'IDLE_STARTED', {
          operatorId: order.logged_in_user_id ?? undefined,
          shiftCode: ppcForMachine.shift_code,
        }),
      ).catch((err) => console.error('[MachineStateEvent] RUNNING_ENDED/IDLE_STARTED failed:', err));
    }

    await this.refreshShiftProductionFromOrder(String(order.order_id));
    return this.getOrder(batchNumber, userId);
  }

  static async updateRolling(batchNumber: string, data: SixHiRollingData, userId: number) {
    const orderId = await this.ensureOrder(batchNumber, userId);
    await assertCrm6OutputWeight(orderId, data.actualWeightMt ?? null);
    const finalThk = data.passes.length > 0 ? data.passes[data.passes.length - 1].thicknessMm : data.finalThkMm;

    await db.updateTable('txn.crm6_rolling')
      .set({
        actual_weight_mt: data.actualWeightMt ?? null,
        destination: data.destination,
        destination_override: data.destinationOverride ?? false,
        associate_rw: data.associateRw ?? null,
        etr: data.etr ?? null,
        dtr: data.dtr ?? null,
        total_passes: data.passes.length,
        final_thk_mm: finalThk ?? null,
      })
      .where('order_id', '=', orderId)
      .execute();

    await db.deleteFrom('txn.crm6_rolling_pass').where('order_id', '=', orderId).execute();
    if (data.passes.length > 0) {
      await db.insertInto('txn.crm6_rolling_pass')
        .values(data.passes.map((p) => ({
          order_id: orderId,
          pass_no: p.passNo,
          thickness_mm: p.thicknessMm,
        })))
        .execute();
    }

    await db.updateTable('txn.crm6_order').set({ updated_at: new Date() }).where('order_id', '=', orderId).execute();
    await this.refreshShiftProductionFromOrder(orderId);
    return this.getOrder(batchNumber, userId);
  }

  static async updateSkinPass(batchNumber: string, data: SixHiSkinPassData, userId: number) {
    const orderId = await this.ensureOrder(batchNumber, userId);
    await assertCrm6OutputWeight(orderId, data.actualWeightMt ?? null);
    await db.updateTable('txn.crm6_skinpass')
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
      })
      .where('order_id', '=', orderId)
      .execute();
    await db.updateTable('txn.crm6_order').set({ updated_at: new Date() }).where('order_id', '=', orderId).execute();
    await this.refreshShiftProductionFromOrder(orderId);
    return this.getOrder(batchNumber, userId);
  }

  static async addStoppage(batchNumber: string, categoryCode: string, breakdownCode: string | undefined, remarks: string | undefined, userId: number) {
    const orderId = await this.ensureOrder(batchNumber, userId);
    const orderRow = await db.selectFrom('txn.crm6_order')
      .select(['status'])
      .where('order_id', '=', orderId)
      .executeTakeFirstOrThrow();

    if (orderRow.status !== 'IN_PROGRESS' && orderRow.status !== 'STOPPAGE') {
      throw new Error('Stoppage can only be recorded while production is running');
    }

    await assertCanStartOrderStoppage(orderId);

    const startAt = new Date();
    await validateOrderStoppageStart(orderId, startAt);

    await db.insertInto('txn.order_stoppage')
      .values({
        order_id: orderId,
        category_code: categoryCode,
        breakdown_code: breakdownCode ?? null,
        remarks: remarks ?? null,
        operator_id: userId,
        start_at: startAt,
      })
      .execute();
    await db.updateTable('txn.crm6_order').set({ status: 'STOPPAGE', updated_at: new Date() }).where('order_id', '=', orderId).execute();

    // Persist machine state event: RUNNING_ENDED → STOPPAGE_STARTED
    const ppc = await db.selectFrom('planning.ppc_batch').select(['machine_code', 'shift_code']).where('batch_number', '=', batchNumber).executeTakeFirst();
    if (ppc) {
      MachineStateEventService.recordEvent(ppc.machine_code, 'STOPPAGE_STARTED', {
        orderId,
        batchNumber,
        operatorId: userId,
        shiftCode: ppc.shift_code,
        categoryCode,
        reason: remarks ?? categoryCode,
      }).catch((err) => console.error('[MachineStateEvent] STOPPAGE_STARTED failed:', err));
    }

    return this.getOrder(batchNumber, userId);
  }

  static async updateStoppage(batchNumber: string, stoppageId: string, categoryCode: string, breakdownCode: string | undefined, remarks: string | undefined, userId: number) {
    const orderId = await this.ensureOrder(batchNumber, userId);
    await db.updateTable('txn.order_stoppage')
      .set({
        category_code: categoryCode,
        breakdown_code: breakdownCode ?? null,
        remarks: remarks ?? null,
      })
      .where('order_id', '=', orderId)
      .where('stoppage_id', '=', stoppageId)
      .execute();
    return this.getOrder(batchNumber, userId);
  }

  static async endStoppage(batchNumber: string, stoppageId: string, userId: number) {
    await this.ensureOrder(batchNumber, userId);
    const order = await db.selectFrom('txn.crm6_order')
      .select(['order_id', 'logged_in_user_id', 'prod_start_at'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirstOrThrow();
    const stop = await db.selectFrom('txn.order_stoppage')
      .selectAll()
      .where('stoppage_id', '=', stoppageId)
      .executeTakeFirstOrThrow();

    if (String(stop.order_id) !== String(order.order_id)) {
      throw new Error('Stoppage does not belong to this order');
    }
    if (stop.end_at) {
      return this.getOrder(batchNumber, userId);
    }

    const endAt = new Date();
    await validateOrderStoppageInterval(order.order_id, stop.start_at, endAt, stoppageId);
    const durationMin = Math.round((endAt.getTime() - stop.start_at.getTime()) / 60000);
    await db.updateTable('txn.order_stoppage')
      .set({ end_at: endAt, duration_min: durationMin })
      .where('stoppage_id', '=', stoppageId)
      .execute();
    const openCount = await db.selectFrom('txn.order_stoppage')
      .select(db.fn.count('stoppage_id').as('c'))
      .where('order_id', '=', order.order_id)
      .where('end_at', 'is', null)
      .executeTakeFirst();
    const resumingToRunning = !!order.prod_start_at;
    if (Number(openCount?.c ?? 0) === 0) {
      await db.updateTable('txn.crm6_order')
        .set({ status: resumingToRunning ? 'IN_PROGRESS' : 'PENDING', updated_at: endAt })
        .where('order_id', '=', order.order_id)
        .execute();
    }

    const ppc = await db.selectFrom('planning.ppc_batch')
      .select(['machine_code', 'shift_code'])
      .where('batch_number', '=', batchNumber)
      .executeTakeFirst();
    if (ppc && Number(openCount?.c ?? 0) === 0) {
      try {
        await MachineStateEventService.recordEvent(ppc.machine_code, 'STOPPAGE_ENDED', {
          orderId: order.order_id,
          batchNumber,
          operatorId: userId,
          shiftCode: ppc.shift_code,
        });
        const nextEvent = resumingToRunning ? 'RUNNING_STARTED' : 'IDLE_STARTED';
        await MachineStateEventService.recordEvent(ppc.machine_code, nextEvent, {
          orderId: resumingToRunning ? order.order_id : undefined,
          batchNumber: resumingToRunning ? batchNumber : undefined,
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
    await db.insertInto('txn.order_remark')
      .values({
        order_id: orderId,
        text,
        operator_id: userId,
        defect_codes: defects?.length ? JSON.stringify(defects) : null,
      })
      .execute();
    return this.getOrder(batchNumber, userId);
  }

  static async getShiftStoppages(shiftLogId: string, machineCode?: string) {
    // Single source of truth: stoppages belong to the shift the order is attributed to
    // (crm6_order.shift_log_id), consistent with production attribution.
    let query = db.selectFrom('txn.order_stoppage as os')
      .innerJoin('txn.crm6_order as o', 'o.order_id', 'os.order_id')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .innerJoin('master.stoppage_category as sc', 'sc.category_code', 'os.category_code')
      .select([
        'os.stoppage_id',
        'os.category_code',
        'sc.label',
        'os.breakdown_code',
        'os.start_at',
        'os.end_at',
        'os.duration_min',
        'os.remarks',
        'o.batch_number',
      ])
      .orderBy('os.start_at', 'desc')
      .where('o.shift_log_id', '=', shiftLogId);

    if (machineCode) {
      query = query.where('pb.machine_code', '=', machineCode);
    }

    const rows = await query.execute();
    return rows.map((s) => ({
      id: String(s.stoppage_id),
      batchNumber: s.batch_number,
      categoryCode: s.category_code,
      categoryLabel: s.label,
      breakdownCode: s.breakdown_code ?? undefined,
      startAt: s.start_at.toISOString(),
      endAt: s.end_at?.toISOString(),
      durationMin: s.duration_min ?? undefined,
      remarks: s.remarks ?? undefined,
    }));
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

  static async getDefectCodes() {
    const codes = await db.selectFrom('master.defect_code')
      .selectAll()
      .where('is_active', 'is not', false)
      .orderBy('defect_code', 'asc')
      .execute();
    const crm6 = codes.filter((c) => !c.applies_to || c.applies_to.includes('CRM6') || c.applies_to.includes('CRM'));
    const source = crm6.length > 0 ? crm6 : codes;
    return source.map(c => ({
      defectCode: c.defect_code,
      defectName: c.description,
      category: c.applies_to,
      isActive: c.is_active ?? true,
    }));
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

  static async rejectOrder(
    batchNumber: string,
    rejectionReason: string,
    defectCodes: string[],
    remarks: string,
    userId: number,
  ) {
    const trimmedRemarks = remarks?.trim();
    if (!rejectionReason?.trim()) {
      throw new Error('Rejection reason is required');
    }
    if (!trimmedRemarks) {
      throw new Error('Rejection remarks are required');
    }

    const orderId = await this.ensureOrder(batchNumber, userId);
    const reasonLabel = rejectionReason.trim().slice(0, 100);

    await db.insertInto('txn.order_rejection')
      .values({
        order_id: orderId,
        rejection_reason: reasonLabel,
        defect_codes: defectCodes.length ? JSON.stringify(defectCodes) : null,
        remarks: trimmedRemarks,
        operator_id: userId,
        tenant_id: getTenantId() || '00000000-0000-0000-0000-000000000001',
      })
      .execute();

    // End active stoppage if any
    const activeStoppage = await db.selectFrom('txn.order_stoppage')
      .select('stoppage_id')
      .where('order_id', '=', orderId)
      .where('end_at', 'is', null)
      .executeTakeFirst();
    
    if (activeStoppage) {
      const stop = await db.selectFrom('txn.order_stoppage')
        .selectAll()
        .where('stoppage_id', '=', activeStoppage.stoppage_id)
        .executeTakeFirstOrThrow();
      const endAt = new Date();
      await validateOrderStoppageInterval(orderId, stop.start_at, endAt, String(activeStoppage.stoppage_id));
      const durationMin = Math.round((endAt.getTime() - stop.start_at.getTime()) / 60000);
      await db.updateTable('txn.order_stoppage')
        .set({ end_at: endAt, duration_min: durationMin })
        .where('stoppage_id', '=', activeStoppage.stoppage_id)
        .execute();
    }

    // Set order status to REJECTED
    await db.updateTable('txn.crm6_order')
      .set({ 
        status: 'REJECTED', 
        updated_at: new Date(),
        prod_end_at: new Date() // End production duration
      })
      .where('order_id', '=', orderId)
      .execute();

    // Persist machine state event: RUNNING_ENDED -> IDLE + ORDER_REJECTED
    const ppc = await db.selectFrom('planning.ppc_batch').select(['machine_code', 'shift_code']).where('batch_number', '=', batchNumber).executeTakeFirst();
    if (ppc) {
      MachineStateEventService.recordEvent(ppc.machine_code, 'RUNNING_ENDED', {
        orderId,
        batchNumber,
        operatorId: userId,
        shiftCode: ppc.shift_code,
      })
      .then(() => MachineStateEventService.recordEvent(ppc.machine_code, 'IDLE_STARTED', {
        orderId, batchNumber, operatorId: userId, shiftCode: ppc.shift_code
      }))
      .then(() => MachineStateEventService.recordEvent(ppc.machine_code, 'ORDER_REJECTED', {
        orderId, batchNumber, operatorId: userId, shiftCode: ppc.shift_code, reason: trimmedRemarks
      }))
      .then(async () => {
        for (const defectCode of defectCodes) {
          await MachineStateEventService.recordEvent(ppc.machine_code, 'DEFECT_REPORTED', {
            orderId, batchNumber, operatorId: userId, shiftCode: ppc.shift_code, categoryCode: defectCode, reason: 'Defect causing rejection'
          });
        }
      })
      .catch((err) => console.error('[MachineStateEvent] REJECT events failed:', err));
    }

    return this.getOrder(batchNumber, userId);
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

  static async getManualStoppageStatus(machineCode: string = '6HI') {
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

    const shift = await ShiftDetectionService.getCurrentShift({ userId, machineCode });
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

    return this.getManualStoppageStatus(machineCode);
  }

  static async endManualStoppage(machineCode: string, userId: number) {
    const currentEvent = await MachineStateEventService.getCurrentEvent(machineCode);
    if (!currentEvent || currentEvent.event_type !== 'STOPPAGE_STARTED' || currentEvent.batch_number) {
      throw new Error('No active manual stoppage on this machine');
    }

    const shiftCode = currentEvent.shift_code ?? undefined;
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
    const orderId = await this.ensureOrder(batchNumber, userId);
    const rolling = await db.selectFrom('txn.crm6_rolling').selectAll().where('order_id', '=', orderId).executeTakeFirst();
    const prevNo = rollPosition === 'IN' ? rolling?.roll_in_no : rolling?.roll_out_no;
    const prevCode = rollPosition === 'IN' ? rolling?.roll_in_code : rolling?.roll_out_code;

    await db.insertInto('txn.crm_roll_change')
      .values({
        order_id: orderId,
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
    await db.updateTable('txn.crm6_rolling').set(patch).where('order_id', '=', orderId).execute();
    return this.getOrder(batchNumber, userId);
  }

  /** In-progress: saved actual weight only. Completed: saved actual or PPC fallback. */
  private static async getOrderProductionWeight(
    orderId: string,
    subProcess: string,
    status: string,
    ppcWeightMt: number,
  ): Promise<number> {
    if (status === 'COMPLETED') {
      return this.resolveOrderWeight(orderId, subProcess, ppcWeightMt);
    }
    return this.getSavedOrderWeight(orderId, subProcess);
  }

  static async getSavedOrderWeight(orderId: string, subProcess: string): Promise<number> {
    if (subProcess === 'ROLLING') {
      const r = await db.selectFrom('txn.crm6_rolling')
        .select('actual_weight_mt')
        .where('order_id', '=', orderId)
        .executeTakeFirst();
      const wt = r?.actual_weight_mt != null ? Number(r.actual_weight_mt) : 0;
      return wt > 0 ? wt : 0;
    }
    const s = await db.selectFrom('txn.crm6_skinpass')
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
  private static async listShiftProductionOrders(shiftLogId: string, machineFilter?: string | string[]) {
    const machineCodes = machineFilter == null
      ? null
      : Array.isArray(machineFilter) ? machineFilter : [machineFilter];

    let query = db
      .selectFrom('txn.crm6_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select([
        'o.order_id',
        'o.batch_number',
        'o.status',
        'o.sub_process',
        'o.customer_name',
        'o.prod_duration_min',
        'o.ppc_weight_mt',
        'pb.ppc_weight_mt as batch_ppc_weight_mt',
      ])
      .where('o.shift_log_id', '=', shiftLogId);

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
      const r = await db.selectFrom('txn.crm6_rolling')
        .select('actual_weight_mt')
        .where('order_id', '=', orderId)
        .executeTakeFirst();
      return r?.actual_weight_mt ? Number(r.actual_weight_mt) : ppcWeight;
    }
    const s = await db.selectFrom('txn.crm6_skinpass')
      .select('actual_weight_mt')
      .where('order_id', '=', orderId)
      .executeTakeFirst();
    return s?.actual_weight_mt ? Number(s.actual_weight_mt) : ppcWeight;
  }

  static async getShiftSummary(shiftLogId: string, machineFilter?: string | string[]): Promise<SixHiShiftSummary> {
    const shiftOrders = await this.listShiftProductionOrders(shiftLogId, machineFilter);

    let completedRolling = 0;
    let completedReroll = 0;
    let completedSkinpass = 0;
    let inProgressRolling = 0;
    let inProgressReroll = 0;
    let inProgressSkinpass = 0;
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
        });
        addWeight(o.sub_process, wt, 'completed');
        if (o.sub_process === 'ROLLING' && wt > 0) {
          const r = await db.selectFrom('txn.crm6_rolling').select('rerolling').where('order_id', '=', o.order_id).executeTakeFirst();
          if (r?.rerolling) completedReroll += wt;
        }
      } else if (o.status === 'IN_PROGRESS' || o.status === 'STOPPAGE') {
        if (wt <= 0) continue;
        addWeight(o.sub_process, wt, 'inProgress');
        if (o.sub_process === 'ROLLING') {
          const r = await db.selectFrom('txn.crm6_rolling').select('rerolling').where('order_id', '=', o.order_id).executeTakeFirst();
          if (r?.rerolling) inProgressReroll += wt;
        }
      }
    }

    const totalRolling = completedRolling + inProgressRolling;
    const totalReroll = completedReroll + inProgressReroll;
    const totalSkinpass = completedSkinpass + inProgressSkinpass;
    const completedProdMt = completedRolling + completedSkinpass;
    const inProgressProdMt = inProgressRolling + inProgressSkinpass;

    const saved = await db.selectFrom('txn.crm6_shift_summary')
      .selectAll()
      .where('shift_log_id', '=', shiftLogId)
      .executeTakeFirst();

    const { ShiftAttributionService } = await import('./ShiftAttributionService');
    const machineCode = Array.isArray(machineFilter) ? machineFilter[0] : machineFilter;
    const metrics = await ShiftAttributionService.getShiftMetrics(shiftLogId, machineCode);

    return {
      shiftLogId,
      totalProdMt: totalRolling + totalSkinpass,
      completedProdMt,
      inProgressProdMt,
      totalRollingMt: totalRolling,
      totalRerollMt: totalReroll,
      totalSkinpassMt: totalSkinpass,
      scrapKg: saved?.scrap_kg ? Number(saved.scrap_kg) : undefined,
      coolantTempDegC: saved?.coolant_temp_degc ? Number(saved.coolant_temp_degc) : undefined,
      coolantPressKgCm2: saved?.coolant_press_kgcm2 ? Number(saved.coolant_press_kgcm2) : undefined,
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
    await db.insertInto('txn.crm6_shift_summary')
      .values({
        shift_log_id: shiftLogId,
        total_prod_mt: summary.totalProdMt,
        total_rolling_mt: summary.totalRollingMt,
        total_reroll_mt: summary.totalRerollMt,
        total_skinpass_mt: summary.totalSkinpassMt,
        scrap_kg: scrapKg ?? null,
        coolant_temp_degc: coolantTempDegC ?? null,
        coolant_press_kgcm2: coolantPressKgCm2 ?? null,
        submitted_at: new Date(),
        submitted_by: userId,
      })
      .onConflict((oc) => oc.column('shift_log_id').doUpdateSet({
        total_prod_mt: summary.totalProdMt,
        total_rolling_mt: summary.totalRollingMt,
        total_reroll_mt: summary.totalRerollMt,
        total_skinpass_mt: summary.totalSkinpassMt,
        scrap_kg: scrapKg ?? null,
        coolant_temp_degc: coolantTempDegC ?? null,
        coolant_press_kgcm2: coolantPressKgCm2 ?? null,
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
    const prodDate = typeof planDate === 'string' ? this.toPlanDate(planDate) : planDate;
    const row = await db.selectFrom('txn.shift_log')
      .select('shift_log_id')
      .where('process_id', '=', processId)
      .where('prod_date', '=', prodDate)
      .where('shift_code', '=', shiftCode)
      .executeTakeFirst();
    return row ? String(row.shift_log_id) : null;
  }

  static async resolveShiftLogIdForOrder(orderId: string): Promise<string | null> {
    const order = await db.selectFrom('txn.crm6_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .select(['o.shift_log_id', 'pb.plan_date', 'pb.shift_code'])
      .where('o.order_id', '=', orderId)
      .executeTakeFirst();
    if (!order) return null;
    if (order.shift_log_id) return String(order.shift_log_id);
    if (order.plan_date && order.shift_code) {
      return this.resolveShiftLogIdForPlan(order.plan_date, order.shift_code);
    }
    return null;
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
