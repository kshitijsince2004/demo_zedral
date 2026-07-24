import { db } from '../db';
import { ShiftDetectionService, resolveShiftFromClock } from './ShiftDetectionService';
import { ShiftAttributionService } from './ShiftAttributionService';
import { MachineHandoverService } from './MachineHandoverService';
import { MachineStateEventService } from './MachineStateEventService';
import { ShiftLogService } from './shiftLogService';
import { getOrderSourceStrategy } from './handover/OrderSource';
import { reparentOpenWork } from './handover/carryForward';
import { publishShiftClosed } from '../platform/m1Events';
import { DeskNotificationService } from './DeskNotificationService';
import {
  addPlantDays,
  formatPlantDate,
  parsePlantDateOnly,
  postgresDateOnly,
} from '@m1/shared-validation';

// ponytail: handovers are operator-submitted; Tier-1 only fires for forgotten stale sessions.

const SYSTEM_USER_ID = Number(process.env.EXPORT_SYSTEM_USER_ID ?? 1);
const AUTO_STUB_REMARKS =
  'System-generated at shift boundary — operator did not submit handover before shift end.';

function logTier1(event: string, payload: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ msg: `tier1_${event}`, ...payload }));
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === '23505' || /unique|duplicate/i.test(String(e?.message ?? ''));
}

export type AutoBoundaryMode = 'off' | 'shadow' | 'on';

/** Global flag. Optional AUTO_BOUNDARY_HANDOVER_MACHINES=M1,M2 (empty = all). */
export function getAutoBoundaryMode(): AutoBoundaryMode {
  const raw = (process.env.AUTO_BOUNDARY_HANDOVER ?? 'off').trim().toLowerCase();
  if (raw === 'shadow' || raw === 'on') return raw;
  return 'off';
}

/**
 * Effective enablement = global allowlist AND machine-master override.
 * master.machine.auto_boundary_handover: NULL inherit, true/false force.
 */
export async function isMachineAutoBoundaryEnabled(machineCode: string): Promise<boolean> {
  if (!isMachineOnAutoBoundaryAllowlist(machineCode)) return false;

  try {
    const row = await db
      .selectFrom('master.machine')
      .select('auto_boundary_handover')
      .where('machine_code', '=', machineCode.toUpperCase())
      .executeTakeFirst();
    if (row?.auto_boundary_handover === false) return false;
    if (row?.auto_boundary_handover === true) return true;
  } catch {
    // Unit tests / early boot without DB — inherit global.
  }
  return true; // NULL = inherit global (caller already in shadow|on)
}

/** Env allowlist only (empty list = all). Used by unit tests. */
export function isMachineOnAutoBoundaryAllowlist(machineCode: string): boolean {
  const list = (process.env.AUTO_BOUNDARY_HANDOVER_MACHINES ?? '').trim();
  if (!list) return true;
  const allowed = new Set(
    list
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
  return allowed.has(machineCode.toUpperCase());
}

export interface BoundaryShiftContext {
  outgoingShiftCode: string;
  outgoingProdDate: string;
  incomingShiftCode: string;
  incomingProdDate: string;
}

function previousShift(shiftCode: string, prodDate: string): { shiftCode: string; prodDate: string } {
  if (shiftCode === 'A') {
    return { shiftCode: 'C', prodDate: addPlantDays(prodDate, -1) };
  }
  if (shiftCode === 'B') return { shiftCode: 'A', prodDate };
  if (shiftCode === 'C') return { shiftCode: 'B', prodDate };
  return { shiftCode, prodDate };
}

export function resolveBoundaryShifts(
  windows: { shift_code: string; name: string; start_time: string; end_time: string }[],
  at: Date,
): BoundaryShiftContext {
  const incoming = resolveShiftFromClock(windows, at);
  const outgoing = previousShift(incoming.shiftCode, incoming.prodDate);

  return {
    outgoingShiftCode: outgoing.shiftCode,
    outgoingProdDate: outgoing.prodDate,
    incomingShiftCode: incoming.shiftCode,
    incomingProdDate: incoming.prodDate,
  };
}

async function deriveMachineStatus(machineCode: string): Promise<string> {
  const ev = await MachineStateEventService.getCurrentEvent(machineCode);
  if (!ev) return 'IDLE';
  const t = String(ev.event_type);
  if (t.startsWith('RUNNING')) return 'RUNNING';
  if (t.startsWith('STOPPAGE')) return 'STOPPAGE';
  if (t.startsWith('BREAKDOWN') || t.includes('BREAKDOWN')) return 'BREAKDOWN';
  if (t.startsWith('MAINTENANCE')) return 'MAINTENANCE';
  if (t.startsWith('IDLE')) return 'IDLE';
  return 'IDLE';
}

/** B1 judgment fields from last MachineStateEvent (§13). */
async function deriveMachineCondition(machineCode: string): Promise<{
  machineCondition: 'NORMAL' | 'ATTENTION' | 'CRITICAL';
  handoverPriority: 'LOW' | 'MEDIUM' | 'HIGH';
  breakdownCode: string | null;
  maintenanceStatus: string | null;
}> {
  const ev = await MachineStateEventService.getCurrentEvent(machineCode);
  if (!ev) {
    return {
      machineCondition: 'NORMAL',
      handoverPriority: 'MEDIUM',
      breakdownCode: null,
      maintenanceStatus: null,
    };
  }
  const t = String(ev.event_type).toUpperCase();
  if (t.includes('BREAKDOWN')) {
    return {
      machineCondition: 'CRITICAL',
      handoverPriority: 'HIGH',
      breakdownCode: null,
      maintenanceStatus: null,
    };
  }
  if (t.includes('MAINTENANCE')) {
    return {
      machineCondition: 'ATTENTION',
      handoverPriority: 'MEDIUM',
      breakdownCode: null,
      maintenanceStatus: 'IN_PROGRESS',
    };
  }
  if (t.includes('STOPPAGE')) {
    return {
      machineCondition: 'ATTENTION',
      handoverPriority: 'MEDIUM',
      breakdownCode: null,
      maintenanceStatus: null,
    };
  }
  return {
    machineCondition: 'NORMAL',
    handoverPriority: 'MEDIUM',
    breakdownCode: null,
    maintenanceStatus: null,
  };
}

/** B2 structured auto remark (§13). Exported for unit tests. */
export function buildAutoRemarks(args: {
  outgoingShiftCode: string;
  incomingShiftCode: string;
  totalProdMt: number;
  openOrderCount: number;
  carriedBatches: string[];
  stoppageMin: number;
  breakdownMin: number;
  machineStatus: string;
}): string {
  const carried =
    args.carriedBatches.length > 0
      ? args.carriedBatches.slice(0, 8).join(', ')
      : 'none';
  const text =
    `System handover at ${args.outgoingShiftCode}→${args.incomingShiftCode} boundary. ` +
    `Produced ${args.totalProdMt.toFixed(3)} MT (${args.openOrderCount} open orders carried). ` +
    `Carried forward: ${carried}. ` +
    `Stoppage ${args.stoppageMin} min, breakdown ${args.breakdownMin} min. ` +
    `Machine ended ${args.machineStatus}. ` +
    AUTO_STUB_REMARKS;
  return text.length >= 20 ? text : AUTO_STUB_REMARKS;
}

async function alreadyBoundaryHandled(
  machineCode: string,
  outgoingShiftCode: string,
  outgoingProdDate: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('txn.machine_handover')
    .select('handover_id')
    .where('machine_code', '=', machineCode)
    .where('outgoing_shift_code', '=', outgoingShiftCode)
    .where((eb) =>
      eb(eb.fn('date', [eb.ref('outgoing_prod_date')]), '=', eb.val(outgoingProdDate)),
    )
    .where((eb) =>
      eb.or([
        eb('created_by_boundary', '=', true),
        eb('status', 'in', ['PENDING', 'AUTO_COMPLETED']),
      ]),
    )
    .executeTakeFirst();
  return !!row;
}

export class ShiftBoundaryService {
  /** @deprecated CRM-only path; Tier-1 uses processStaleSessions instead. */
  static async listCrmMachineCodes(): Promise<string[]> {
    const rows = await db
      .selectFrom('master.machine')
      .select('machine_code')
      .where('process_code', '=', 'CRM')
      .orderBy('machine_code', 'asc')
      .execute();
    return rows.map((r) => r.machine_code);
  }

  /** @deprecated unused by scheduler — kept for tests / manual ops. */
  static async processAllMachines(at = new Date()): Promise<{ processed: number }> {
    const windows = await ShiftDetectionService.listShiftWindows();
    const boundary = resolveBoundaryShifts(windows, at);
    const machines = await this.listCrmMachineCodes();
    for (const machineCode of machines) {
      await this.processMachine(machineCode, boundary);
    }
    await db
      .insertInto('txn.shift_event_audit')
      .values({
        event_type: 'SHIFT_BOUNDARY',
        entity_type: 'boundary',
        entity_id: `${boundary.outgoingShiftCode}:${boundary.outgoingProdDate}`,
        payload: { ...boundary, machineCount: machines.length },
        user_id: SYSTEM_USER_ID,
      })
      .execute();
    return { processed: machines.length };
  }

  /** @deprecated CRM idle-only; no carry-forward. */
  static async processMachine(
    machineCode: string,
    boundary: BoundaryShiftContext,
  ): Promise<'IDLE' | 'SKIPPED'> {
    const existing = await MachineHandoverService.getPendingForMachine(machineCode);
    if (existing) return 'SKIPPED';

    const { SixHiExecutionService } = await import('./sixHi');
    const active = await SixHiExecutionService.findActiveMachineOrder(machineCode);

    await ShiftAttributionService.attributeMachineOrder(
      machineCode,
      boundary.outgoingShiftCode,
      boundary.outgoingProdDate,
    );

    if (active) return 'SKIPPED';

    await db
      .updateTable('txn.machine_shift_session')
      .set({ status: 'CLOSED', closed_at: new Date() })
      .where('machine_code', '=', machineCode)
      .where('status', '=', 'ACTIVE')
      .execute();

    const shiftLogId = await ShiftAttributionService.resolveShiftLogId(
      boundary.outgoingShiftCode,
      boundary.outgoingProdDate,
    );
    if (shiftLogId) {
      const { SixHiShiftService } = await import('./sixHi');
      await SixHiShiftService.saveShiftSummary(shiftLogId, undefined, undefined, undefined, SYSTEM_USER_ID);
    }

    await db
      .insertInto('txn.shift_event_audit')
      .values({
        event_type: 'SHIFT_BOUNDARY_IDLE',
        entity_type: 'machine',
        entity_id: machineCode,
        machine_code: machineCode,
        user_id: SYSTEM_USER_ID,
        payload: {
          outgoingShift: boundary.outgoingShiftCode,
          outgoingProdDate: boundary.outgoingProdDate,
        },
      })
      .execute();

    return 'IDLE';
  }

  /**
   * Tier-1 sweep: for each stale ACTIVE session, auto carry-forward (or shadow audit).
   * Returns count of sessions closed (plain or via Tier-1).
   */
  static async processStaleSessions(mode: AutoBoundaryMode = getAutoBoundaryMode()): Promise<number> {
    if (mode === 'off') {
      return ShiftDetectionService.closeAllStaleActiveSessions();
    }

    const stale = await ShiftDetectionService.listStaleActiveSessions();
    let closed = 0;
    logTier1('sweep_start', { mode, staleCount: stale.length });

    for (const session of stale) {
      try {
        if (!(await isMachineAutoBoundaryEnabled(session.machine_code))) {
          logTier1('skipped', {
            reason: 'allowlist',
            machineCode: session.machine_code,
            sessionId: session.session_id,
          });
          await db
            .updateTable('txn.machine_shift_session')
            .set({ status: 'CLOSED', closed_at: new Date() })
            .where('session_id', '=', session.session_id)
            .execute();
          closed += 1;
          continue;
        }

        const result = await this.autoCarryForwardStale(session, mode);
        if (result === 'CLOSED' || result === 'AUTO' || result === 'SHADOW') {
          // shadow / skip paths still plain-close so plant isn't worse than today
          if (result === 'SHADOW' || result === 'CLOSED') {
            await db
              .updateTable('txn.machine_shift_session')
              .set({ status: 'CLOSED', closed_at: new Date() })
              .where('session_id', '=', session.session_id)
              .where('status', '=', 'ACTIVE')
              .execute();
          }
          closed += 1;
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          logTier1('duplicate_prevented', {
            machineCode: session.machine_code,
            sessionId: session.session_id,
          });
          await db
            .updateTable('txn.machine_shift_session')
            .set({ status: 'CLOSED', closed_at: new Date() })
            .where('session_id', '=', session.session_id)
            .where('status', '=', 'ACTIVE')
            .execute();
          closed += 1;
          continue;
        }
        logTier1('failed', {
          machineCode: session.machine_code,
          sessionId: session.session_id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue other machines — one failure must not abort the sweep.
      }
    }

    logTier1('sweep_done', { mode, closed });
    return closed;
  }

  static async autoCarryForwardStale(
    session: {
      session_id: string;
      machine_code: string;
      shift_code: string;
      prod_date: Date | string;
      operator_user_id: number;
      shift_log_id: string | null;
    },
    mode: AutoBoundaryMode,
  ): Promise<'AUTO' | 'SHADOW' | 'CLOSED' | 'SKIPPED'> {
    const machineCode = session.machine_code;
    const outgoingShiftCode = session.shift_code;
    const outgoingProdDate = formatPlantDate(session.prod_date);

    logTier1('start', {
      mode,
      machineCode,
      sessionId: session.session_id,
      outgoingShiftCode,
      outgoingProdDate,
    });

    const pending = await MachineHandoverService.getPendingForMachine(machineCode);
    if (pending) {
      logTier1('skipped', { reason: 'pending_exists', machineCode, sessionId: session.session_id });
      return 'CLOSED'; // plain close caller
    }

    if (await alreadyBoundaryHandled(machineCode, outgoingShiftCode, outgoingProdDate)) {
      logTier1('skipped', { reason: 'already_handled', machineCode, sessionId: session.session_id });
      return 'CLOSED';
    }

    const { nextShiftCode, nextProdDate } = ShiftLogService.getNextShift(
      outgoingShiftCode,
      parsePlantDateOnly(outgoingProdDate),
    );
    const incomingShiftCode = nextShiftCode;
    const incomingProdDate = formatPlantDate(nextProdDate);

    const machineRow = await db
      .selectFrom('master.machine')
      .select(['process_code', 'process_id'])
      .where('machine_code', '=', machineCode)
      .executeTakeFirst();

    let processId: number | null = null;
    if (machineRow?.process_id) processId = Number(machineRow.process_id);
    else if (machineRow?.process_code) {
      const pRow = await db
        .selectFrom('master.process')
        .select('process_id')
        .where('code', '=', machineRow.process_code)
        .executeTakeFirst();
      if (pRow) processId = pRow.process_id;
    }

    const strategy = getOrderSourceStrategy(machineCode);
    let outgoingShiftLogId =
      session.shift_log_id ??
      (await strategy.resolveShiftLogIdForPlan(
        outgoingProdDate,
        outgoingShiftCode,
        machineCode,
        processId,
      ));

    if (mode === 'shadow') {
      let openStoppages = 0;
      let openOrders = 0;
      if (outgoingShiftLogId) {
        const stop = await db
          .selectFrom('txn.stoppage')
          .select((eb) => eb.fn.countAll<number>().as('c'))
          .where('shift_log_id', '=', outgoingShiftLogId as any)
          .where('end_at', 'is', null)
          .executeTakeFirst();
        openStoppages = Number(stop?.c ?? 0);
        const ord = await db
          .selectFrom('txn.crm_order')
          .select((eb) => eb.fn.countAll<number>().as('c'))
          .where('shift_log_id', '=', outgoingShiftLogId as any)
          .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
          .executeTakeFirst();
        openOrders = Number(ord?.c ?? 0);
      }
      await db
        .insertInto('txn.shift_event_audit')
        .values({
          event_type: 'AUTO_HANDOVER_BOUNDARY',
          entity_type: 'machine',
          entity_id: machineCode,
          machine_code: machineCode,
          user_id: SYSTEM_USER_ID,
          payload: {
            mode: 'shadow',
            outgoingShiftCode,
            outgoingProdDate,
            incomingShiftCode,
            incomingProdDate,
            sessionId: session.session_id,
            operatorUserId: session.operator_user_id,
            outgoingShiftLogId,
            wouldCarry: { openStoppages, openOrders },
          },
        })
        .execute();
      logTier1('shadow', {
        machineCode,
        sessionId: session.session_id,
        openStoppages,
        openOrders,
        incomingShiftCode,
        incomingProdDate,
      });
      return 'SHADOW';
    }

    // mode === 'on'
    const incomingShiftLogId = await strategy.ensureActiveShiftLog(
      SYSTEM_USER_ID,
      incomingProdDate,
      incomingShiftCode,
      machineCode,
      processId,
    );

    if (!outgoingShiftLogId) {
      outgoingShiftLogId = await strategy.resolveShiftLogIdForPlan(
        outgoingProdDate,
        outgoingShiftCode,
        machineCode,
        processId,
      );
    }

    await ShiftAttributionService.attributeMachineOrder(
      machineCode,
      outgoingShiftCode,
      outgoingProdDate,
    );

    let totalProdMt = 0;
    if (outgoingShiftLogId) {
      try {
        await strategy.saveShiftSummary(outgoingShiftLogId, {}, SYSTEM_USER_ID);
        const summary = await strategy.getShiftSummary(outgoingShiftLogId, machineCode);
        totalProdMt = Number(summary?.totalProdMt ?? 0);
      } catch (err) {
        logTier1('summary_failed', {
          machineCode,
          outgoingShiftLogId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const machineStatus = await deriveMachineStatus(machineCode);
    const condition = await deriveMachineCondition(machineCode);
    const now = new Date();
    const outgoingDateOnly = postgresDateOnly(outgoingProdDate);
    const incomingDateOnly = postgresDateOnly(incomingProdDate);

    // Snapshot latest in-shift readings (B3) + scrap prefill (C) before carry-forward.
    let readings: {
      scrapKg: number | null;
      coolantTempDegC: number | null;
      coolantPressKgCm2: number | null;
    } = { scrapKg: null, coolantTempDegC: null, coolantPressKgCm2: null };
    let openOrderCount = 0;
    let carriedBatches: string[] = [];
    let stoppageMin = 0;
    let breakdownMin = 0;

    if (outgoingShiftLogId) {
      const summaryRow = await db
        .selectFrom('txn.crm_shift_summary')
        .select(['scrap_kg', 'coolant_temp_degc', 'coolant_press_kgcm2'])
        .where('shift_log_id', '=', outgoingShiftLogId as any)
        .executeTakeFirst();
      if (summaryRow) {
        readings = {
          scrapKg: summaryRow.scrap_kg != null ? Number(summaryRow.scrap_kg) : null,
          coolantTempDegC:
            summaryRow.coolant_temp_degc != null ? Number(summaryRow.coolant_temp_degc) : null,
          coolantPressKgCm2:
            summaryRow.coolant_press_kgcm2 != null ? Number(summaryRow.coolant_press_kgcm2) : null,
        };
      }

      const openOrders = await db
        .selectFrom('txn.crm_order as o')
        .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
        .select(['pb.batch_number'])
        .where('o.shift_log_id', '=', outgoingShiftLogId as any)
        .where('o.status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
        .execute()
        .catch(() => []);
      openOrderCount = openOrders.length;
      carriedBatches = openOrders.map((o) => String(o.batch_number));

      const stopAgg = await db
        .selectFrom('txn.stoppage')
        .select((eb) => eb.fn.sum<number>('duration_min').as('mins'))
        .where('shift_log_id', '=', outgoingShiftLogId as any)
        .executeTakeFirst()
        .catch(() => null);
      stoppageMin = Number(stopAgg?.mins ?? 0);
    }

    const remarks = buildAutoRemarks({
      outgoingShiftCode,
      incomingShiftCode,
      totalProdMt,
      openOrderCount,
      carriedBatches,
      stoppageMin,
      breakdownMin,
      machineStatus,
    });

    let handoverId: string | null = null;
    try {
      handoverId = await db.transaction().execute(async (trx) => {
        // Re-check PENDING inside trx to avoid racing a late manual submit.
        const pendingNow = await trx
          .selectFrom('txn.machine_handover')
          .select('handover_id')
          .where('machine_code', '=', machineCode)
          .where('status', '=', 'PENDING')
          .executeTakeFirst();
        if (pendingNow) {
          throw Object.assign(new Error('PENDING_RACE'), { code: 'PENDING_RACE' });
        }

        await trx
          .deleteFrom('txn.machine_handover')
          .where('machine_code', '=', machineCode)
          .where('status', '=', 'DRAFT')
          .execute();

        if (outgoingShiftLogId) {
          await reparentOpenWork(trx, {
            machineCode,
            processId,
            outgoingShiftLogId,
            incomingShiftLogId,
            incomingShiftCode,
            incomingProdDate,
            updatedAt: now,
          });
          logTier1('carry_forward', {
            machineCode,
            outgoingShiftLogId,
            incomingShiftLogId,
            processId,
          });
        }

        await trx
          .updateTable('txn.machine_shift_session')
          .set({ status: 'CLOSED', closed_at: now })
          .where('session_id', '=', session.session_id)
          .execute();

        const row = await trx
          .insertInto('txn.machine_handover')
          .values({
            machine_code: machineCode,
            process_code: machineCode,
            outgoing_shift_code: outgoingShiftCode,
            incoming_shift_code: incomingShiftCode,
            outgoing_prod_date: outgoingDateOnly as any,
            incoming_prod_date: incomingDateOnly as any,
            outgoing_operator_id: session.operator_user_id,
            incoming_operator_id: null,
            machine_status: machineStatus,
            handover_priority: condition.handoverPriority,
            breakdown_code: condition.breakdownCode,
            maintenance_status: condition.maintenanceStatus,
            remarks,
            status: 'AUTO_COMPLETED',
            created_by_boundary: true,
            accepted_at: now,
            production_snapshot: {
              autoBoundary: true,
              pendingReview: true,
              outgoingShiftLogId,
              incomingShiftLogId,
              machineCondition: condition.machineCondition,
              readings,
              condition,
            } as any,
            open_stoppages: [] as any,
            queue_snapshot: { carriedBatches } as any,
          })
          .returning('handover_id')
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('txn.shift_event_audit')
          .values({
            event_type: 'AUTO_HANDOVER_BOUNDARY',
            entity_type: 'machine_handover',
            entity_id: String(row.handover_id),
            machine_code: machineCode,
            user_id: SYSTEM_USER_ID,
            payload: {
              mode: 'on',
              outgoingShiftCode,
              outgoingProdDate,
              incomingShiftCode,
              incomingProdDate,
              sessionId: session.session_id,
              operatorUserId: session.operator_user_id,
              outgoingShiftLogId,
              incomingShiftLogId,
              totalProdMt,
              readings,
              condition,
            },
          })
          .execute();

        return String(row.handover_id);
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'PENDING_RACE') {
        logTier1('skipped', { reason: 'pending_race', machineCode, sessionId: session.session_id });
        return 'CLOSED';
      }
      throw err;
    }

    if (outgoingShiftLogId && processId != null) {
      try {
        await publishShiftClosed({
          shiftLogId: outgoingShiftLogId,
          processId,
          totalProdMt,
        });
      } catch (err) {
        logTier1('shift_closed_publish_failed', {
          outgoingShiftLogId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // §10 MH notification — never roll back carry-forward on notify failure.
    if (handoverId) {
      void DeskNotificationService.notifyMachineHeadsAutoHandover({
        machineCode,
        handoverId,
        shiftLogId: outgoingShiftLogId,
        outgoingShiftCode,
        outgoingProdDate,
        operatorUserId: session.operator_user_id,
      }).catch((err) => {
        logTier1('notify_failed', {
          machineCode,
          handoverId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    logTier1('success', {
      machineCode,
      sessionId: session.session_id,
      handoverId,
      outgoingShiftCode,
      outgoingProdDate,
      incomingShiftCode,
      incomingProdDate,
      outgoingShiftLogId,
      incomingShiftLogId,
      totalProdMt,
    });

    return 'AUTO';
  }
}
