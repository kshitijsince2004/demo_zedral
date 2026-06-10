import { db } from '../db';
import { SixHiService } from './SixHiService';
import { ShiftDetectionService } from './ShiftDetectionService';
import { ShiftLogService } from './shiftLogService';
import { CrewService } from './ancillaryServices';
import { MachineStateEventService } from './MachineStateEventService';
import type { BoundaryShiftContext } from './ShiftBoundaryService';

export type MachineHandoverStatus =
  | 'RUNNING'
  | 'IDLE'
  | 'BREAKDOWN'
  | 'MAINTENANCE'
  | 'STOPPAGE';

export type HandoverPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface OutgoingHandoverInput {
  machineStatus: MachineHandoverStatus;
  machineCondition?: 'NORMAL' | 'ATTENTION_REQUIRED' | 'CRITICAL';
  machineConditionRemarks?: string;
  remarks: string;
  handoverPriority?: HandoverPriority;
  breakdownCode?: string;
  breakdownDescription?: string;
  downtimeMinutes?: number;
  maintenanceStatus?: string;
  // Shift manual fields
  scrapKg?: number;
  coolantTempDegC?: number;
  coolantPressKgCm2?: number;
  shiftRemarks?: string;
  // Order snapshot (manual operator fill)
  orderSnapshot?: {
    currentStage?: string;
    currentPassNumber?: number;
    currentThicknessMm?: number;
    targetThicknessMm?: number;
    nextActionRequired?: string;
    orderRemarks?: string;
  };
  // Crew notes (manual fallback when no shift log)
  crewNotes?: string;
}

export class MachineHandoverService {
  static async listPendingForMachines(machineCodes: string[]) {
    if (machineCodes.length === 0) return [];
    return db
      .selectFrom('txn.machine_handover')
      .selectAll()
      .where('machine_code', 'in', machineCodes)
      .where('status', '=', 'PENDING')
      .orderBy('created_at', 'desc')
      .execute();
  }

  static async getPendingForMachine(machineCode: string) {
    return db
      .selectFrom('txn.machine_handover')
      .selectAll()
      .where('machine_code', '=', machineCode)
      .where('status', '=', 'PENDING')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
  }

  /** Get an existing DRAFT for this operator+machine, if any */
  static async getDraftForMachine(machineCode: string, operatorUserId: number) {
    return db
      .selectFrom('txn.machine_handover')
      .selectAll()
      .where('machine_code', '=', machineCode)
      .where('outgoing_operator_id', '=', operatorUserId)
      .where('status', '=', 'DRAFT')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
  }

  /** Block production mutations until incoming operator accepts pending handover. */
  static async assertProductionAllowed(machineCode: string, userId: number): Promise<void> {
    const pending = await this.getPendingForMachine(machineCode);
    if (!pending) return;

    const acceptedSession = await db
      .selectFrom('txn.machine_shift_session')
      .select('session_id')
      .where('machine_code', '=', machineCode)
      .where('operator_user_id', '=', userId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();

    if (acceptedSession) return;

    throw new Error(
      'PENDING_HANDOVER: Accept the pending handover before changing production on this machine.',
    );
  }

  static async buildOutgoingPreview(machineCode: string, operatorUserId: number) {
    const shift = await ShiftDetectionService.getCurrentShift({
      userId: operatorUserId,
      machineCode,
    });
    const active = await SixHiService.findActiveMachineOrder(machineCode);
    const rollingQueue = await SixHiService.getQueue('ROLLING', shift.prodDate, shift.shiftCode, machineCode);
    const skinQueue = await SixHiService.getQueue('SKIN_PASS', shift.prodDate, shift.shiftCode, machineCode);

    let productionSnapshot: Record<string, unknown> = {};
    let openStoppages: unknown[] = [];
    let runtimeMinutes: number | null = null;
    let processLabel = '—';
    let activeOrderDetail: Record<string, unknown> | null = null;

    if (active) {
      const order = await SixHiService.getOrder(active.batchNumber, operatorUserId);
      const prodStartAt = order.prodStartAt;
      const actualWt = order.rolling?.actualWeightMt ?? order.skinPass?.actualWeightMt ?? 0;
      const targetWt = order.ppcWeightMt ?? 0;
      const progressPct = targetWt > 0
        ? Math.min(100, Math.round((actualWt / targetWt) * 100))
        : 0;
      const remainingMt = Math.max(0, targetWt - actualWt);

      activeOrderDetail = {
        batchNumber: active.batchNumber,
        customer: order.customer,
        grade: order.grade,
        subProcess: active.subProcess,
        status: active.status,
        startTime: prodStartAt ?? null,
        runtimeMinutes: order.prodDurationMin ?? null,
        progressPct,
        producedWeightMt: actualWt,
        remainingWeightMt: remainingMt,
        targetWeightMt: targetWt,
        destinationProcess: order.ppcDestination ?? null,
        currentPassNo: order.rolling?.totalPasses ?? null,
        targetThkMm: order.targetThkMm ?? null,
      };

      productionSnapshot = {
        batchNumber: active.batchNumber,
        status: active.status,
        subProcess: active.subProcess,
        rolling: order.rolling,
        skinPass: order.skinPass,
      };
      openStoppages = (order.stoppages ?? []).filter((s) => !s.endAt);
      runtimeMinutes = order.prodDurationMin ?? null;
      processLabel = active.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Rolling';
    }

    const machineStatus: MachineHandoverStatus = active
      ? active.status === 'STOPPAGE'
        ? 'STOPPAGE'
        : 'RUNNING'
      : 'IDLE';

    const { nextShiftCode, nextProdDate } = ShiftLogService.getNextShift(
      shift.shiftCode,
      new Date(shift.prodDate),
    );

    // Look up shift log ID from shift_log table for current shift
    let shiftLogIdResolved: string | null = null;
    try {
      const slRow = await db
        .selectFrom('txn.shift_log')
        .select('shift_log_id')
        .where('shift_code', '=', shift.shiftCode)
        .where((eb) => eb(eb.fn('date', [eb.ref('prod_date')]), '=', eb.val(shift.prodDate)))
        .orderBy('shift_log_id', 'desc')
        .executeTakeFirst();
      if (slRow) shiftLogIdResolved = String(slRow.shift_log_id);
    } catch {
      // Non-fatal
    }

    // Shift production summary — use SixHiService if shiftLogId available
    let shiftProductionSummary: Record<string, unknown> | null = null;
    let crewSnapshot: unknown[] = [];

    if (shiftLogIdResolved) {
      try {
        const summary = await SixHiService.getShiftSummary(shiftLogIdResolved, machineCode);
        shiftProductionSummary = {
          totalProdMt: summary.totalProdMt,
          totalRollingMt: summary.totalRollingMt,
          totalSkinpassMt: summary.totalSkinpassMt,
          totalRerollMt: summary.totalRerollMt,
          completedOrderCount: summary.completedOrders?.length ?? 0,
          inProgressOrderCount: summary.ordersInProgress ?? 0,
          totalStoppageMinutes: summary.totalStoppageMinutes ?? 0,
          totalBreakdownMinutes: summary.totalBreakdownMinutes ?? 0,
          machineUtilizationPct: summary.machineUtilizationPct ?? 0,
          coolantTempDegC: summary.coolantTempDegC,
          coolantPressKgCm2: summary.coolantPressKgCm2,
          scrapKg: summary.scrapKg,
        };
        crewSnapshot = await CrewService.listByShiftLog(shiftLogIdResolved);
      } catch {
        // Non-fatal — shift log may not exist yet
      }
    }

    // Machine utilization from event-based service (last 12h)
    let utilizationMetrics: Record<string, unknown> | null = null;
    try {
      const util = await MachineStateEventService.getUtilizationSummary(machineCode, 12);
      utilizationMetrics = {
        runningPct: util.runningPct,
        stopPagePct: util.stopPagePct,
        idlePct: util.idlePct,
        runningMin: util.runningMin,
        stoppageMin: util.stoppageMin,
        stoppageCount: util.stoppageCount,
      };
    } catch {
      // Non-fatal
    }

    // Machine name
    const machineRow = await db
      .selectFrom('master.machine')
      .select(['name', 'process_code'])
      .where('machine_code', '=', machineCode)
      .executeTakeFirst();

    return {
      machineCode,
      machineName: machineRow?.name ?? machineCode,
      processCode: machineRow?.process_code ?? machineCode,
      shift,
      machineStatus,
      activeOrder: active,
      activeOrderDetail,
      runtimeMinutes,
      processLabel,
      productionSnapshot,
      openStoppages,
      shiftProductionSummary,
      crewSnapshot,
      utilizationMetrics,
      queueSnapshot: {
        rolling: rollingQueue.queue.slice(0, 5),
        skinpass: skinQueue.queue.slice(0, 5),
        pendingAllocation: rollingQueue.pendingAllocation.slice(0, 5),
      },
      nextShift: {
        shiftCode: nextShiftCode,
        prodDate: nextProdDate.toISOString().slice(0, 10),
      },
    };
  }

  /**
   * Save or update a DRAFT handover for this operator+machine.
   * Creates a new row if none exists; updates existing DRAFT if found.
   */
  static async saveDraftHandover(
    machineCode: string,
    operatorUserId: number,
    input: Partial<OutgoingHandoverInput>,
  ) {
    const preview = await this.buildOutgoingPreview(machineCode, operatorUserId);
    const active = preview.activeOrder;

    const { nextShiftCode, nextProdDate } = ShiftLogService.getNextShift(
      preview.shift.shiftCode,
      new Date(preview.shift.prodDate),
    );

    let orderId: number | null = null;
    if (active) {
      const row = await db
        .selectFrom('txn.crm6_order')
        .select('order_id')
        .where('batch_number', '=', active.batchNumber)
        .executeTakeFirst();
      orderId = row ? Number(row.order_id) : null;
    }

    // Merge operator's inputs into production_snapshot for rich incoming view
    const enrichedProductionSnapshot = {
      ...preview.productionSnapshot,
      orderSnapshot: input.orderSnapshot ?? null,
      machineCondition: input.machineCondition ?? 'NORMAL',
      machineConditionRemarks: input.machineConditionRemarks ?? null,
      crewNotes: input.crewNotes ?? null,
      shiftManualFields: {
        scrapKg: input.scrapKg ?? null,
        coolantTempDegC: input.coolantTempDegC ?? null,
        coolantPressKgCm2: input.coolantPressKgCm2 ?? null,
        shiftRemarks: input.shiftRemarks ?? null,
      },
      shiftProductionSummary: preview.shiftProductionSummary,
      utilizationMetrics: preview.utilizationMetrics,
      queueSnapshot: preview.queueSnapshot,
    };

    const existingDraft = await this.getDraftForMachine(machineCode, operatorUserId);

    if (existingDraft) {
      return db
        .updateTable('txn.machine_handover')
        .set({
          machine_status: input.machineStatus ?? preview.machineStatus,
          remarks: input.remarks?.trim() ?? existingDraft.remarks,
          handover_priority: input.handoverPriority ?? 'NORMAL',
          breakdown_code: input.breakdownCode ?? null,
          breakdown_description: input.breakdownDescription ?? null,
          downtime_minutes: input.downtimeMinutes ?? null,
          maintenance_status: input.maintenanceStatus ?? null,
          production_snapshot: enrichedProductionSnapshot,
          open_stoppages: preview.openStoppages,
          batch_number: active?.batchNumber ?? null,
          order_id: orderId,
        })
        .where('handover_id', '=', existingDraft.handover_id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    return db
      .insertInto('txn.machine_handover')
      .values({
        machine_code: machineCode,
        process_code: machineCode,
        order_id: orderId,
        batch_number: active?.batchNumber ?? null,
        outgoing_shift_code: preview.shift.shiftCode,
        incoming_shift_code: nextShiftCode,
        outgoing_prod_date: preview.shift.prodDate,
        incoming_prod_date: nextProdDate.toISOString().slice(0, 10),
        outgoing_operator_id: operatorUserId,
        machine_status: input.machineStatus ?? preview.machineStatus,
        breakdown_code: input.breakdownCode ?? null,
        breakdown_description: input.breakdownDescription ?? null,
        downtime_minutes: input.downtimeMinutes ?? null,
        maintenance_status: input.maintenanceStatus ?? null,
        remarks: input.remarks?.trim() ?? '',
        handover_priority: input.handoverPriority ?? 'NORMAL',
        production_snapshot: enrichedProductionSnapshot,
        open_stoppages: preview.openStoppages,
        status: 'DRAFT',
        created_by_boundary: false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  static async createOutgoingHandover(
    machineCode: string,
    operatorUserId: number,
    input: OutgoingHandoverInput,
  ) {
    if (!input.remarks?.trim() || input.remarks.trim().length < 20) {
      throw new Error('Handover notes must be at least 20 characters');
    }

    const existing = await this.getPendingForMachine(machineCode);
    if (existing) {
      throw new Error('A pending handover already exists for this machine');
    }

    const preview = await this.buildOutgoingPreview(machineCode, operatorUserId);
    const active = preview.activeOrder;

    const { nextShiftCode, nextProdDate } = ShiftLogService.getNextShift(
      preview.shift.shiftCode,
      new Date(preview.shift.prodDate),
    );

    let orderId: number | null = null;
    if (active) {
      const row = await db
        .selectFrom('txn.crm6_order')
        .select('order_id')
        .where('batch_number', '=', active.batchNumber)
        .executeTakeFirst();
      orderId = row ? Number(row.order_id) : null;
    }

    const enrichedProductionSnapshot = {
      ...preview.productionSnapshot,
      orderSnapshot: input.orderSnapshot ?? null,
      machineCondition: input.machineCondition ?? 'NORMAL',
      machineConditionRemarks: input.machineConditionRemarks ?? null,
      crewNotes: input.crewNotes ?? null,
      shiftManualFields: {
        scrapKg: input.scrapKg ?? null,
        coolantTempDegC: input.coolantTempDegC ?? null,
        coolantPressKgCm2: input.coolantPressKgCm2 ?? null,
        shiftRemarks: input.shiftRemarks ?? null,
      },
      shiftProductionSummary: preview.shiftProductionSummary,
      utilizationMetrics: preview.utilizationMetrics,
      activeOrderDetail: preview.activeOrderDetail,
      queueSnapshot: preview.queueSnapshot,
    };

    const handover = await db.transaction().execute(async (trx) => {
      // Delete any existing DRAFT before promoting to PENDING
      await trx
        .deleteFrom('txn.machine_handover')
        .where('machine_code', '=', machineCode)
        .where('outgoing_operator_id', '=', operatorUserId)
        .where('status', '=', 'DRAFT')
        .execute();

      const row = await trx
        .insertInto('txn.machine_handover')
        .values({
          machine_code: machineCode,
          process_code: machineCode,
          order_id: orderId,
          batch_number: active?.batchNumber ?? null,
          outgoing_shift_code: preview.shift.shiftCode,
          incoming_shift_code: nextShiftCode,
          outgoing_prod_date: preview.shift.prodDate,
          incoming_prod_date: nextProdDate.toISOString().slice(0, 10),
          outgoing_operator_id: operatorUserId,
          machine_status: input.machineStatus,
          breakdown_code: input.breakdownCode ?? null,
          breakdown_description: input.breakdownDescription ?? null,
          downtime_minutes: input.downtimeMinutes ?? null,
          maintenance_status: input.maintenanceStatus ?? null,
          remarks: input.remarks.trim(),
          handover_priority: input.handoverPriority ?? 'NORMAL',
          production_snapshot: enrichedProductionSnapshot,
          open_stoppages: preview.openStoppages,
          status: 'PENDING',
          created_by_boundary: false,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('txn.machine_shift_session')
        .set({ status: 'CLOSED', closed_at: new Date() })
        .where('machine_code', '=', machineCode)
        .where('operator_user_id', '=', operatorUserId)
        .where('status', '=', 'ACTIVE')
        .execute();

      await trx
        .insertInto('txn.shift_event_audit')
        .values({
          event_type: 'HANDOVER_CREATED',
          entity_type: 'machine_handover',
          entity_id: String(row.handover_id),
          machine_code: machineCode,
          user_id: operatorUserId,
          payload: {
            batchNumber: active?.batchNumber ?? null,
            machineStatus: input.machineStatus,
            handoverPriority: input.handoverPriority ?? 'NORMAL',
            outgoingShift: preview.shift.shiftCode,
            incomingShift: nextShiftCode,
          },
        })
        .execute();

      return row;
    });

    return handover;
  }

  /** Auto handover at shift boundary when production is still active. */
  static async createBoundaryHandover(
    machineCode: string,
    boundary: BoundaryShiftContext,
    systemUserId: number,
  ) {
    const existing = await this.getPendingForMachine(machineCode);
    if (existing) return existing;

    const session = await db
      .selectFrom('txn.machine_shift_session')
      .select('operator_user_id')
      .where('machine_code', '=', machineCode)
      .where('status', '=', 'ACTIVE')
      .orderBy('started_at', 'desc')
      .executeTakeFirst();

    const outgoingOperatorId = session?.operator_user_id ?? systemUserId;
    const preview = await this.buildOutgoingPreview(machineCode, outgoingOperatorId);
    const active = preview.activeOrder;

    let orderId: number | null = null;
    if (active) {
      const row = await db
        .selectFrom('txn.crm6_order')
        .select('order_id')
        .where('batch_number', '=', active.batchNumber)
        .executeTakeFirst();
      orderId = row ? Number(row.order_id) : null;
    }

    const machineStatus: MachineHandoverStatus = active
      ? active.status === 'STOPPAGE'
        ? 'STOPPAGE'
        : 'RUNNING'
      : 'IDLE';

    const remarks =
      'Auto-generated at shift boundary. Production continues; incoming operator must accept.';

    return db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('txn.machine_handover')
        .values({
          machine_code: machineCode,
          process_code: machineCode,
          order_id: orderId,
          batch_number: active?.batchNumber ?? null,
          outgoing_shift_code: boundary.outgoingShiftCode,
          incoming_shift_code: boundary.incomingShiftCode,
          outgoing_prod_date: boundary.outgoingProdDate,
          incoming_prod_date: boundary.incomingProdDate,
          outgoing_operator_id: outgoingOperatorId,
          machine_status: machineStatus,
          remarks,
          handover_priority: 'NORMAL',
          queue_snapshot: preview.queueSnapshot,
          production_snapshot: {
            ...preview.productionSnapshot,
            shiftProductionSummary: preview.shiftProductionSummary,
            activeOrderDetail: preview.activeOrderDetail,
          },
          open_stoppages: preview.openStoppages,
          status: 'PENDING',
          created_by_boundary: true,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('txn.machine_shift_session')
        .set({ status: 'CLOSED', closed_at: new Date() })
        .where('machine_code', '=', machineCode)
        .where('status', '=', 'ACTIVE')
        .execute();

      await trx
        .insertInto('txn.shift_event_audit')
        .values({
          event_type: 'BOUNDARY_HANDOVER_CREATED',
          entity_type: 'machine_handover',
          entity_id: String(row.handover_id),
          machine_code: machineCode,
          user_id: systemUserId,
          payload: {
            batchNumber: active?.batchNumber ?? null,
            outgoingShift: boundary.outgoingShiftCode,
            incomingShift: boundary.incomingShiftCode,
          },
        })
        .execute();

      return row;
    });
  }

  static async getHandoverOverview(machineFilter: string[] | null) {
    let pendingQ = db
      .selectFrom('txn.machine_handover as h')
      .leftJoin('security.app_user as ou', 'ou.user_id', 'h.outgoing_operator_id')
      .leftJoin('security.app_user as iu', 'iu.user_id', 'h.incoming_operator_id')
      .select([
        'h.handover_id',
        'h.machine_code',
        'h.batch_number',
        'h.machine_status',
        'h.status',
        'h.handover_priority',
        'h.outgoing_shift_code',
        'h.incoming_shift_code',
        'h.created_at',
        'h.accepted_at',
        'h.created_by_boundary',
        'ou.username as outgoing_username',
        'iu.username as incoming_username',
      ])
      .where('h.status', '=', 'PENDING')
      .orderBy('h.created_at', 'desc');

    if (machineFilter !== null) {
      if (machineFilter.length === 0) {
        return { pending: [], recent: [], awaitingAcceptance: 0 };
      }
      pendingQ = pendingQ.where('h.machine_code', 'in', machineFilter);
    }

    const pending = await pendingQ.limit(20).execute();

    let recentQ = db
      .selectFrom('txn.machine_handover as h')
      .leftJoin('security.app_user as ou', 'ou.user_id', 'h.outgoing_operator_id')
      .leftJoin('security.app_user as iu', 'iu.user_id', 'h.incoming_operator_id')
      .select([
        'h.handover_id',
        'h.machine_code',
        'h.batch_number',
        'h.machine_status',
        'h.status',
        'h.handover_priority',
        'h.outgoing_shift_code',
        'h.incoming_shift_code',
        'h.created_at',
        'h.accepted_at',
        'h.created_by_boundary',
        'ou.username as outgoing_username',
        'iu.username as incoming_username',
      ])
      .where('h.status', 'in', ['ACCEPTED', 'CLARIFICATION_REQUESTED'])
      .orderBy('h.created_at', 'desc')
      .limit(15);

    if (machineFilter !== null && machineFilter.length > 0) {
      recentQ = recentQ.where('h.machine_code', 'in', machineFilter);
    } else if (machineFilter !== null) {
      return { pending: [], recent: [], awaitingAcceptance: 0 };
    }

    const recent = await recentQ.execute();

    const mapRow = (h: typeof pending[0]) => ({
      handoverId: String(h.handover_id),
      machineCode: h.machine_code,
      batchNumber: h.batch_number,
      machineStatus: h.machine_status,
      status: h.status,
      handoverPriority: h.handover_priority,
      outgoingShiftCode: h.outgoing_shift_code,
      incomingShiftCode: h.incoming_shift_code,
      createdAt: new Date(h.created_at as Date).toISOString(),
      acceptedAt: h.accepted_at ? new Date(h.accepted_at as Date).toISOString() : undefined,
      outgoingUsername: h.outgoing_username ?? undefined,
      incomingUsername: h.incoming_username ?? undefined,
      createdByBoundary: h.created_by_boundary,
    });

    return {
      pending: pending.map(mapRow),
      recent: recent.map(mapRow),
      awaitingAcceptance: pending.length,
    };
  }

  static async acceptHandover(handoverId: string, incomingUserId: number) {
    const handover = await db
      .selectFrom('txn.machine_handover')
      .selectAll()
      .where('handover_id', '=', handoverId)
      .executeTakeFirst();

    if (!handover) throw new Error('Handover not found');
    if (handover.status !== 'PENDING') {
      throw new Error(`Handover is ${handover.status}, not pending acceptance`);
    }

    const acceptedAt = new Date();
    const shift = await ShiftDetectionService.getCurrentShift({
      userId: incomingUserId,
      machineCode: handover.machine_code,
    });

    return db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('txn.machine_handover')
        .set({
          status: 'ACCEPTED',
          incoming_operator_id: incomingUserId,
          accepted_at: acceptedAt,
        })
        .where('handover_id', '=', handoverId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('txn.machine_shift_session')
        .values({
          machine_code: handover.machine_code,
          shift_code: shift.shiftCode,
          prod_date: shift.prodDate,
          operator_user_id: incomingUserId,
          status: 'ACTIVE',
        })
        .execute();

      await trx
        .insertInto('txn.shift_event_audit')
        .values({
          event_type: 'HANDOVER_ACCEPTED',
          entity_type: 'machine_handover',
          entity_id: handoverId,
          machine_code: handover.machine_code,
          user_id: incomingUserId,
          payload: { batchNumber: handover.batch_number },
        })
        .execute();

      return updated;
    });
  }

  static async requestClarification(
    handoverId: string,
    incomingUserId: number,
    notes: string,
  ) {
    if (!notes?.trim()) throw new Error('Clarification notes are required');

    const handover = await db
      .selectFrom('txn.machine_handover')
      .selectAll()
      .where('handover_id', '=', handoverId)
      .executeTakeFirst();

    if (!handover) throw new Error('Handover not found');
    if (handover.status !== 'PENDING') {
      throw new Error(`Handover is ${handover.status}`);
    }

    const updated = await db
      .updateTable('txn.machine_handover')
      .set({
        status: 'CLARIFICATION_REQUESTED',
        incoming_operator_id: incomingUserId,
        clarification_notes: notes.trim(),
      })
      .where('handover_id', '=', handoverId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto('txn.shift_event_audit')
      .values({
        event_type: 'HANDOVER_CLARIFICATION',
        entity_type: 'machine_handover',
        entity_id: handoverId,
        machine_code: handover.machine_code,
        user_id: incomingUserId,
        payload: { notes: notes.trim() },
      })
      .execute();

    return updated;
  }

  /** Start or resume operator session on machine login. */
  static async ensureActiveSession(machineCode: string, operatorUserId: number) {
    const pending = await this.getPendingForMachine(machineCode);
    if (pending) {
      return { session: null, pendingHandover: pending };
    }

    const existing = await db
      .selectFrom('txn.machine_shift_session')
      .selectAll()
      .where('machine_code', '=', machineCode)
      .where('operator_user_id', '=', operatorUserId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();

    if (existing) return { session: existing, pendingHandover: null };

    const shift = await ShiftDetectionService.getCurrentShift({
      userId: operatorUserId,
      machineCode,
    });

    const session = await db
      .insertInto('txn.machine_shift_session')
      .values({
        machine_code: machineCode,
        shift_code: shift.shiftCode,
        prod_date: shift.prodDate,
        operator_user_id: operatorUserId,
        status: 'ACTIVE',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { session, pendingHandover: null };
  }
}
