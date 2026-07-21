import { db } from '../db';
import { SixHiExecutionService, SixHiQueueService, SixHiShiftService } from './sixHi';
import { ShiftDetectionService, type DetectedShift } from './ShiftDetectionService';
import { ShiftLogService } from './shiftLogService';
import { CrewService } from './ancillaryServices';
import { MachineStateEventService } from './MachineStateEventService';
import {
  canCompleteOutgoingHandover,
  resolveShiftSinceTime,
  formatDurationMinutes,
} from '../validation/manufacturingValidation';
import { formatPlantDate, parsePlantDateOnly, postgresDateOnly } from '@m1/shared-validation';
import { parseCrmMillCode } from '../utils/machineAllocation';
import { getOrderSourceStrategy } from './handover/OrderSource';
import type { SixHiQueueCard } from '@m1/shared-validation';
import { ShiftLogValidationService } from './shiftLogValidationService';
import { publishShiftClosed } from '../platform/m1Events';

/**
 * Outgoing handover closes the pinned ACTIVE session (via getCurrentShift with machine).
 * Also loads session start for utilization windowing.
 */
async function resolveOutgoingShift(
  machineCode: string,
  operatorUserId: number,
): Promise<{ shift: DetectedShift; actualSessionStartAt: string | null }> {
  const shift = await ShiftDetectionService.getCurrentShift({
    userId: operatorUserId,
    machineCode,
  });

  const activeSession = await db
    .selectFrom('txn.machine_shift_session')
    .select('started_at')
    .where('machine_code', '=', machineCode)
    .where('status', '=', 'ACTIVE')
    .orderBy('started_at', 'desc')
    .executeTakeFirst();

  return {
    shift,
    actualSessionStartAt: activeSession?.started_at
      ? new Date(activeSession.started_at).toISOString()
      : null,
  };
}

export type MachineHandoverStatus =
  | 'RUNNING'
  | 'IDLE'
  | 'BREAKDOWN'
  | 'MAINTENANCE'
  | 'STOPPAGE';

export type HandoverPriority = 'LOW' | 'NORMAL' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

function normalizeHandoverPriority(priority?: HandoverPriority): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (priority === 'LOW') return 'LOW';
  if (priority === 'HIGH' || priority === 'CRITICAL') return 'HIGH';
  return 'MEDIUM';
}

function formatProdDate(value: Date | string): string {
  return formatPlantDate(value);
}

function mergeQueueCards(...groups: SixHiQueueCard[][]): SixHiQueueCard[] {
  const seen = new Set<string>();
  const merged: SixHiQueueCard[] = [];
  for (const group of groups) {
    for (const card of group) {
      if (seen.has(card.batchNumber)) continue;
      seen.add(card.batchNumber);
      merged.push(card);
    }
  }
  return merged;
}

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
  selectedCrewIds?: string[];
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
    // Machine details and process mapping
    const machineRow = await db
      .selectFrom('master.machine')
      .select(['name', 'process_code', 'process_id'])
      .where('machine_code', '=', machineCode)
      .executeTakeFirst();

    let processIdResolved: number | null = null;
    if (machineRow) {
      if (machineRow.process_id) {
        processIdResolved = Number(machineRow.process_id);
      } else if (machineRow.process_code) {
        const pRow = await db
          .selectFrom('master.process')
          .select('process_id')
          .where('code', '=', machineRow.process_code)
          .executeTakeFirst();
        if (pRow) processIdResolved = pRow.process_id;
      }
    }

    // Prefer ACTIVE session over clock — closing C after 06:00 must stay C→A, not A→B.
    const { shift, actualSessionStartAt } = await resolveOutgoingShift(
      machineCode,
      operatorUserId,
    );

    const scheduledWindowStart = shift.windowStart;
    const scheduledWindowEnd = shift.windowEnd;

    const strategy = getOrderSourceStrategy(machineCode);
    const active = await strategy.findActiveOrder(machineCode);
    const queueSnapshot = await strategy.getQueueSnapshot(shift.prodDate, shift.shiftCode, machineCode);

    let productionSnapshot: Record<string, unknown> = {};
    let openStoppages: unknown[] = [];
    let runtimeMinutes: number | null = null;
    let processLabel = '—';
    let activeOrderDetail: Record<string, unknown> | null = null;

    if (active) {
      const orderDetail = await strategy.getOrderDetail(machineCode, operatorUserId);
      activeOrderDetail = orderDetail.activeOrderDetail as unknown as Record<string, unknown>;
      productionSnapshot = orderDetail.productionSnapshot;
      openStoppages = orderDetail.openStoppages;
      runtimeMinutes = orderDetail.runtimeMinutes;
      processLabel = orderDetail.processLabel;
    }

    const machineStatus: MachineHandoverStatus = active
      ? active.status === 'STOPPAGE'
        ? 'STOPPAGE'
        : 'RUNNING'
      : 'IDLE';

    const { nextShiftCode, nextProdDate } = ShiftLogService.getNextShift(
      shift.shiftCode,
      parsePlantDateOnly(shift.prodDate),
    );

    let shiftLogIdResolved: string | null = null;
    try {
      shiftLogIdResolved = await strategy.resolveShiftLogIdForPlan(
        shift.prodDate,
        shift.shiftCode,
        machineCode,
        processIdResolved
      );
      if (!shiftLogIdResolved) {
        shiftLogIdResolved = await strategy.ensureActiveShiftLog(
          operatorUserId,
          shift.prodDate,
          shift.shiftCode,
          machineCode,
          processIdResolved
        );
      }
    } catch (err) {
      console.error('[buildOutgoingPreview] Shift log lookup failed:', err);
    }

    // Shift production summary
    let shiftProductionSummary: Record<string, unknown> | null = null;
    let crewSnapshot: unknown[] = [];

    if (shiftLogIdResolved) {
      try {
        const summary = await strategy.getShiftSummary(shiftLogIdResolved, machineCode);
        if (summary) {
          shiftProductionSummary = summary as Record<string, unknown>;
        }
        
        // Crew resolution (Model B read path)
        const session = await db
          .selectFrom('txn.machine_shift_session')
          .select('session_id')
          .where('shift_log_id', '=', shiftLogIdResolved)
          .where('machine_code', '=', machineCode)
          .executeTakeFirst();
          
        if (session) {
          crewSnapshot = await CrewService.listBySession(String(session.session_id));
        }
      } catch (err) {
        console.error('[buildOutgoingPreview] Shift production summary failed:', err);
      }
    }

    // Machine utilization from event-based service for the current shift
    let utilizationMetrics: Record<string, unknown> | null = null;
    try {
      const since = resolveShiftSinceTime(shift.prodDate, scheduledWindowStart, actualSessionStartAt);
      const util = await MachineStateEventService.getUtilizationSummary(machineCode, 8, since);
      utilizationMetrics = {
        runningPct: util.runningPct,
        stopPagePct: util.stopPagePct,
        idlePct: util.idlePct,
        runningMin: util.runningMin,
        stoppageMin: util.stoppageMin,
        stoppageCount: util.stoppageCount,
      };

      if (shiftProductionSummary) {
         shiftProductionSummary.machineUtilizationPct = util.runningPct;
         shiftProductionSummary.totalStoppageMinutes = util.stoppageMin;
         shiftProductionSummary.totalBreakdownMinutes = util.breakdownMin;
      }
    } catch (err) {
      console.error('[buildOutgoingPreview] Utilization error:', err);
    }

    const { MachineCrewService } = await import('./MachineCrewService');
    let machineCrewRoster: Awaited<ReturnType<typeof MachineCrewService.list>> = [];
    try {
      machineCrewRoster = await MachineCrewService.list(machineCode);
    } catch {
      // Non-fatal when roster table unavailable
    }

    // Reused machineRow resolved at the top of the method

    return {
      machineCode,
      machineName: machineRow?.name ?? machineCode,
      processCode: machineRow?.process_code ?? machineCode,
      processId: processIdResolved,
      shift: {
        ...shift,
        windowStart: scheduledWindowStart,
        windowEnd: scheduledWindowEnd,
        actualSessionStartAt,
      },
      shiftLogId: shiftLogIdResolved,
      machineStatus,
      activeOrder: active,
      activeOrderDetail,
      runtimeMinutes,
      processLabel,
      productionSnapshot,
      openStoppages,
      shiftProductionSummary,
      crewSnapshot,
      machineCrewRoster,
      utilizationMetrics,
      queueSnapshot,
      nextShift: {
        shiftCode: nextShiftCode,
        prodDate: formatProdDate(nextProdDate),
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
      parsePlantDateOnly(preview.shift.prodDate),
    );

    let orderId: number | null = null;
    if (active) {
      const row = await db
        .selectFrom('txn.crm_order')
        .select('order_id')
        .where('batch_number', '=', active.batchNumber)
        .executeTakeFirst();
      orderId = row ? Number(row.order_id) : null;
    }

    // Merge operator's inputs into production_snapshot for rich incoming view
    const selectedCrewMembers = (input.selectedCrewIds ?? [])
      .map((id) => preview.machineCrewRoster?.find((c) => c.id === id))
      .filter(Boolean);
    const enrichedProductionSnapshot = {
      ...preview.productionSnapshot,
      orderSnapshot: input.orderSnapshot ?? null,
      machineCondition: input.machineCondition ?? 'NORMAL',
      machineConditionRemarks: input.machineConditionRemarks ?? null,
      crewNotes: input.crewNotes ?? null,
      selectedCrewMembers,
      shiftManualFields: {
        scrapKg: input.scrapKg ?? null,
        coolantTempDegC: input.coolantTempDegC ?? null,
        coolantPressKgCm2: input.coolantPressKgCm2 ?? null,
        shiftRemarks: input.shiftRemarks ?? null,
      },
      shiftProductionSummary: preview.shiftProductionSummary as any,
      utilizationMetrics: preview.utilizationMetrics,
      queueSnapshot: preview.queueSnapshot as any,
    };

    const existingDraft = await this.getDraftForMachine(machineCode, operatorUserId);

    if (existingDraft) {
      return db
        .updateTable('txn.machine_handover')
        .set({
          outgoing_shift_code: preview.shift.shiftCode,
          incoming_shift_code: nextShiftCode,
          outgoing_prod_date: preview.shift.prodDate,
          incoming_prod_date: formatProdDate(nextProdDate),
          machine_status: input.machineStatus ?? preview.machineStatus,
          remarks: input.remarks?.trim() ?? existingDraft.remarks,
          handover_priority: normalizeHandoverPriority(input.handoverPriority),
          breakdown_code: input.breakdownCode ?? null,
          breakdown_description: input.breakdownDescription ?? null,
          downtime_minutes: input.downtimeMinutes ?? null,
          maintenance_status: input.maintenanceStatus ?? null,
          production_snapshot: enrichedProductionSnapshot as any,
          open_stoppages: preview.openStoppages as any,
          queue_snapshot: preview.queueSnapshot as any,
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
        incoming_prod_date: formatProdDate(nextProdDate),
        outgoing_operator_id: operatorUserId,
        machine_status: input.machineStatus ?? preview.machineStatus,
        breakdown_code: input.breakdownCode ?? null,
        breakdown_description: input.breakdownDescription ?? null,
        downtime_minutes: input.downtimeMinutes ?? null,
        maintenance_status: input.maintenanceStatus ?? null,
        remarks: input.remarks?.trim() ?? '',
        handover_priority: normalizeHandoverPriority(input.handoverPriority),
        production_snapshot: enrichedProductionSnapshot as any,
        open_stoppages: preview.openStoppages as any,
        queue_snapshot: preview.queueSnapshot as any,
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

    const windows = await ShiftDetectionService.listShiftWindows();
    if (!canCompleteOutgoingHandover(preview.shift, windows)) {
      throw new Error(
        `Shift handover cannot be completed before the current shift's scheduled end time (${preview.shift.windowEnd}).`,
      );
    }

    if (preview.shiftLogId && preview.processId != null && preview.processId >= 1 && preview.processId <= 9) {
      await ShiftLogValidationService.assertValid(preview.shiftLogId);
    }

    const active = preview.activeOrder;

    const { nextShiftCode, nextProdDate } = ShiftLogService.getNextShift(
      preview.shift.shiftCode,
      parsePlantDateOnly(preview.shift.prodDate),
    );

    let orderId: number | null = null;
    if (active) {
      const row = await db
        .selectFrom('txn.crm_order')
        .select('order_id')
        .where('batch_number', '=', active.batchNumber)
        .executeTakeFirst();
      orderId = row ? Number(row.order_id) : null;
    }

    const selectedCrewMembers = (input.selectedCrewIds ?? [])
      .map((id) => preview.machineCrewRoster?.find((c) => c.id === id))
      .filter(Boolean);
    const enrichedProductionSnapshot = {
      ...preview.productionSnapshot,
      orderSnapshot: input.orderSnapshot ?? null,
      machineCondition: input.machineCondition ?? 'NORMAL',
      machineConditionRemarks: input.machineConditionRemarks ?? null,
      crewNotes: input.crewNotes ?? null,
      selectedCrewMembers,
      shiftManualFields: {
        scrapKg: input.scrapKg ?? null,
        coolantTempDegC: input.coolantTempDegC ?? null,
        coolantPressKgCm2: input.coolantPressKgCm2 ?? null,
        shiftRemarks: input.shiftRemarks ?? null,
      },
      shiftProductionSummary: preview.shiftProductionSummary as any,
      utilizationMetrics: preview.utilizationMetrics,
      activeOrderDetail: preview.activeOrderDetail,
      queueSnapshot: preview.queueSnapshot as any,
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
          incoming_prod_date: formatProdDate(nextProdDate),
          outgoing_operator_id: operatorUserId,
          machine_status: input.machineStatus,
          breakdown_code: input.breakdownCode ?? null,
          breakdown_description: input.breakdownDescription ?? null,
          downtime_minutes: input.downtimeMinutes ?? null,
          maintenance_status: input.maintenanceStatus ?? null,
          remarks: input.remarks.trim(),
          handover_priority: normalizeHandoverPriority(input.handoverPriority),
          production_snapshot: enrichedProductionSnapshot as any,
          open_stoppages: preview.openStoppages as any,
          queue_snapshot: preview.queueSnapshot as any,
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

    if (preview.shiftLogId) {
      try {
        const strategy = getOrderSourceStrategy(machineCode);
        await strategy.saveShiftSummary(
          preview.shiftLogId,
          {
            scrapKg: input.scrapKg,
            coolantTempDegC: input.coolantTempDegC,
            coolantPressKgCm2: input.coolantPressKgCm2,
          },
          operatorUserId,
        );
      } catch (err) {
        console.error('[createOutgoingHandover] Shift summary finalization failed:', err);
      }

      try {
        await publishShiftClosed({
          shiftLogId: String(preview.shiftLogId),
          processId: preview.processId as number,
          totalProdMt: (preview.shiftProductionSummary?.totalProdMt ?? 0) as number,
        });
      } catch (err) {
        console.error('[createOutgoingHandover] Domain event publish failed:', err);
      }
    }

    return handover;
  }

  static async getHandoverOverview(machineFilter: string[] | null) {
    const handoverSelect = [
      'h.handover_id',
      'h.machine_code',
      'h.batch_number',
      'h.machine_status',
      'h.status',
      'h.handover_priority',
      'h.outgoing_shift_code',
      'h.incoming_shift_code',
      'h.outgoing_operator_id',
      'h.outgoing_prod_date',
      'h.created_at',
      'h.accepted_at',
      'h.created_by_boundary',
      'ou.username as outgoing_username',
      'iu.username as incoming_username',
    ] as const;

    let pendingQ = db
      .selectFrom('txn.machine_handover as h')
      .leftJoin('security.app_user as ou', 'ou.user_id', 'h.outgoing_operator_id')
      .leftJoin('security.app_user as iu', 'iu.user_id', 'h.incoming_operator_id')
      .leftJoin('planning.ppc_batch as pb', 'pb.batch_number', 'h.batch_number')
      .select([...handoverSelect, 'pb.sub_process', 'pb.coil_no', 'pb.slit_id'])
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
      .leftJoin('planning.ppc_batch as pb', 'pb.batch_number', 'h.batch_number')
      .select([...handoverSelect, 'pb.sub_process', 'pb.coil_no', 'pb.slit_id'])
      .where('h.status', 'in', ['ACCEPTED', 'CLARIFICATION_REQUESTED'])
      .orderBy('h.created_at', 'desc')
      .limit(15);

    if (machineFilter !== null && machineFilter.length > 0) {
      recentQ = recentQ.where('h.machine_code', 'in', machineFilter);
    } else if (machineFilter !== null) {
      return { pending: [], recent: [], awaitingAcceptance: 0 };
    }

    const recent = await recentQ.execute();

    const mapRow = async (h: typeof pending[0]) => {
      const prodDate = h.outgoing_prod_date instanceof Date
        ? formatProdDate(h.outgoing_prod_date)
        : String(h.outgoing_prod_date).slice(0, 10);

      const session = await db
        .selectFrom('txn.machine_shift_session')
        .select(['started_at', 'closed_at'])
        .where('machine_code', '=', h.machine_code)
        .where('operator_user_id', '=', h.outgoing_operator_id)
        .where('shift_code', '=', h.outgoing_shift_code)
        .where((eb) => eb(eb.fn('date', [eb.ref('prod_date')]), '=', eb.val(prodDate)))
        .orderBy('started_at', 'desc')
        .executeTakeFirst();

      const shiftStartAt = session?.started_at
        ? new Date(session.started_at).toISOString()
        : new Date(h.created_at as Date).toISOString();
      const shiftEndAt = h.accepted_at
        ? new Date(h.accepted_at as Date).toISOString()
        : undefined;
      const shiftDurationMinutes = shiftEndAt
        ? Math.max(0, Math.round((new Date(shiftEndAt).getTime() - new Date(shiftStartAt).getTime()) / 60000))
        : undefined;

      const coilNo = h.coil_no?.trim() || undefined;
      const slitId = h.slit_id?.trim() || undefined;
      return {
        handoverId: String(h.handover_id),
        machineCode: h.machine_code,
        batchNumber: h.batch_number,
        machineStatus: h.machine_status,
        status: h.status,
        handoverPriority: h.handover_priority,
        outgoingShiftCode: h.outgoing_shift_code,
        incomingShiftCode: h.incoming_shift_code,
        createdAt: new Date(h.created_at as Date).toISOString(),
        acceptedAt: shiftEndAt,
        shiftStartAt,
        shiftEndAt,
        shiftDurationMinutes,
        shiftDurationLabel: shiftDurationMinutes != null ? formatDurationMinutes(shiftDurationMinutes) : undefined,
        outgoingUsername: h.outgoing_username ?? undefined,
        incomingUsername: h.incoming_username ?? undefined,
        createdByBoundary: h.created_by_boundary,
        subProcess: h.sub_process ?? undefined,
        coilNo,
        motherCoil: coilNo,
        slitId,
      };
    };

    return {
      pending: await Promise.all(pending.map(mapRow)),
      recent: await Promise.all(recent.map(mapRow)),
      awaitingAcceptance: pending.length,
    };
  }

  static async getHandoverForAccess(handoverId: string) {
    return db
      .selectFrom('txn.machine_handover')
      .select(['handover_id', 'machine_code', 'status'])
      .where('handover_id', '=', handoverId)
      .executeTakeFirst();
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
    const incomingShiftCode = handover.incoming_shift_code;
    // DATE column: string YYYY-MM-DD — Date objects shift a day on UTC hosts.
    const incomingProdDate = postgresDateOnly(
      formatProdDate(handover.incoming_prod_date as Date | string),
    );

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
        .updateTable('txn.machine_shift_session')
        .set({ status: 'CLOSED', closed_at: acceptedAt })
        .where('machine_code', '=', handover.machine_code)
        .where('status', '=', 'ACTIVE')
        .execute();

      // Resolve incoming shift_log before session insert (fix 3.3)
      let acceptProcessId: number | null = null;
      const acceptMachineRow = await trx.selectFrom('master.machine').select(['process_code', 'process_id']).where('machine_code', '=', handover.machine_code).executeTakeFirst();
      if (acceptMachineRow?.process_id) acceptProcessId = Number(acceptMachineRow.process_id);
      else if (acceptMachineRow?.process_code) {
        const pRow = await trx.selectFrom('master.process').select('process_id').where('code', '=', acceptMachineRow.process_code).executeTakeFirst();
        if (pRow) acceptProcessId = pRow.process_id;
      }

      const acceptStrategy = getOrderSourceStrategy(handover.machine_code);
      const incomingShiftLogIdForSession = await acceptStrategy.ensureActiveShiftLog(
        incomingUserId,
        formatProdDate(handover.incoming_prod_date as any),
        handover.incoming_shift_code,
        handover.machine_code,
        acceptProcessId,
      );

      const newSession = await trx
        .insertInto('txn.machine_shift_session')
        .values({
          machine_code: handover.machine_code,
          shift_code: incomingShiftCode,
          prod_date: incomingProdDate,
          operator_user_id: incomingUserId,
          status: 'ACTIVE',
          shift_log_id: incomingShiftLogIdForSession as any,
        })
        .returning('session_id')
        .executeTakeFirstOrThrow();

      const snapshotData = handover.production_snapshot as any;
      const selectedCrewMembers = snapshotData?.selectedCrewMembers as any[] | undefined;
      
      if (selectedCrewMembers && selectedCrewMembers.length > 0) {
        const crewRows = selectedCrewMembers.map((c) => ({
          session_id: newSession.session_id,
          crew_id: Number(c.id)
        }));
        await trx
          .insertInto('txn.session_crew')
          .values(crewRows)
          .execute();
      }

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

      // Generic open-work carry-forward (Phase 1.4)
      if (handover.outgoing_shift_code && handover.outgoing_prod_date && handover.incoming_shift_code && handover.incoming_prod_date) {
        let outgoingShiftLogId: string | null = null;
        const processIdResolved = acceptProcessId;

        try {
          outgoingShiftLogId = await acceptStrategy.resolveShiftLogIdForPlan(
            formatProdDate(handover.outgoing_prod_date as any),
            handover.outgoing_shift_code,
            handover.machine_code,
            processIdResolved
          );
        } catch (err) {
          console.error('[acceptHandover] Failed to resolve outgoing shiftLogId:', err);
        }

        const incomingShiftLogId = incomingShiftLogIdForSession;

        if (outgoingShiftLogId && incomingShiftLogId) {
            // Carry forward open stoppages
            await trx.updateTable('txn.stoppage')
              .set({ shift_log_id: incomingShiftLogId as any })
              .where('shift_log_id', '=', outgoingShiftLogId as any)
              .where('end_at', 'is', null)
              .execute();

            // Re-parent open 6HI / CRM orders (IN_PROGRESS + STOPPAGE)
            const rollingProcess = await trx.selectFrom('master.process')
              .select('process_id')
              .where('code', 'in', ['ROLLING', 'CRM'])
              .execute();
            const rollingIds = new Set(rollingProcess.map((p) => Number(p.process_id)));
            if (processIdResolved != null && rollingIds.has(processIdResolved)) {
              await trx.updateTable('txn.crm_order')
                .set({
                  shift_log_id: incomingShiftLogId as any,
                  shift_code: handover.incoming_shift_code,
                  prod_date: incomingProdDate,
                  production_day: incomingProdDate,
                  updated_at: acceptedAt,
                } as any)
                .where('shift_log_id', '=', outgoingShiftLogId as any)
                .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
                .execute();
            }

            // Re-parent open processes based on processId
            if (processIdResolved === 4) {
              // ANN
              await trx.updateTable('txn.prod_ann_entry' as any)
                .set({ shift_log_id: incomingShiftLogId as any })
                .where('shift_log_id', '=', outgoingShiftLogId as any)
                .where('status', '=', 'IN_PROGRESS')
                .execute();
            } else if (processIdResolved === 2) {
              // PKL
              await trx.updateTable('txn.prod_pkl_entry' as any)
                .set({ shift_log_id: incomingShiftLogId as any })
                .where('shift_log_id', '=', outgoingShiftLogId as any)
                .where('status', '=', 'IN_PROGRESS')
                .execute();
            } else if (processIdResolved === 5) {
              // SKP
              await trx.updateTable('txn.prod_skp_entry' as any)
                .set({ shift_log_id: incomingShiftLogId as any })
                .where('shift_log_id', '=', outgoingShiftLogId as any)
                .where('status', '=', 'IN_PROGRESS')
                .execute();
            } else if (processIdResolved === 6) {
              // RWD
              await trx.updateTable('txn.prod_rwd_entry' as any)
                .set({ shift_log_id: incomingShiftLogId as any })
                .where('shift_log_id', '=', outgoingShiftLogId as any)
                .where('status', '=', 'IN_PROGRESS')
                .execute();
            } else if (processIdResolved === 7) {
              // CRS
              await trx.updateTable('txn.prod_crs_entry' as any)
                .set({ shift_log_id: incomingShiftLogId as any })
                .where('shift_log_id', '=', outgoingShiftLogId as any)
                .where('status', '=', 'IN_PROGRESS')
                .execute();
            } else if (processIdResolved === 8) {
              // CTL
              await trx.updateTable('txn.prod_ctl_entry' as any)
                .set({ shift_log_id: incomingShiftLogId as any })
                .where('shift_log_id', '=', outgoingShiftLogId as any)
                .where('status', '=', 'IN_PROGRESS')
                .execute();
            }
        }
      }

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

  /** Start or resume operator session on machine login. Reuses only window-live sessions. */
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
      .orderBy('started_at', 'desc')
      .executeTakeFirst();

    if (existing) {
      const existingLive = await ShiftDetectionService.isSessionLiveById(String(existing.session_id));
      if (existingLive) {
        return { session: existing, pendingHandover: null }; // genuine live / overtime reuse
      }
      // Past shift-end + grace — close without asking getCurrentShift(machineCode) (circular pin).
      await ShiftDetectionService.closeStaleOperatorSessions(machineCode, operatorUserId);
      // fall through to create a fresh session for the current clock shift
    }

    // Close any other operator's non-live ACTIVE before conflict check (fix 2.2).
    await ShiftDetectionService.closeStaleSessionsOnMachine(machineCode);

    const otherActive = await db
      .selectFrom('txn.machine_shift_session')
      .select('session_id')
      .where('machine_code', '=', machineCode)
      .where('status', '=', 'ACTIVE')
      .where('operator_user_id', '!=', operatorUserId)
      .executeTakeFirst();

    if (otherActive) {
      throw new Error(
        'ACTIVE_SESSION_CONFLICT: Another operator holds an active session on this machine.',
      );
    }

    // No open session — start one for the current clock/override shift.
    const shift = await ShiftDetectionService.getCurrentShift({
      userId: operatorUserId,
      // Do not pass machineCode here: we already know there is no live session;
      // machine pin would be empty and we want clock/override for the new row.
    });

    const machineRow = await db
      .selectFrom('master.machine')
      .select(['process_code', 'process_id'])
      .where('machine_code', '=', machineCode)
      .executeTakeFirst();
    
    let processIdResolved: number | null = null;
    if (machineRow) {
      if (machineRow.process_id) {
        processIdResolved = Number(machineRow.process_id);
      } else if (machineRow.process_code) {
        const pRow = await db
          .selectFrom('master.process')
          .select('process_id')
          .where('code', '=', machineRow.process_code)
          .executeTakeFirst();
        if (pRow) processIdResolved = pRow.process_id;
      }
    }

    const strategy = getOrderSourceStrategy(machineCode);
    const shiftLogId = await strategy.ensureActiveShiftLog(
      operatorUserId,
      shift.prodDate,
      shift.shiftCode,
      machineCode,
      processIdResolved
    );

    const session = await db
      .insertInto('txn.machine_shift_session')
      .values({
        machine_code: machineCode,
        shift_code: shift.shiftCode,
        prod_date: postgresDateOnly(shift.prodDate) as any,
        operator_user_id: operatorUserId,
        status: 'ACTIVE',
        shift_log_id: shiftLogId as any,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { session, pendingHandover: null };
  }
}
