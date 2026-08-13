import { db } from '../db';
import {
  DEFAULT_PLANT_SHIFT_WINDOWS,
  formatDbDate,
  formatPlantDate,
  postgresDateOnly,
  resolveShiftFromClock,
  currentPlantDate,
  addPlantDays,
  parsePlantDateOnly,
  plantClockDate,
  type PlantShiftWindow,
} from '@m1/shared-validation';

const OVERTIME_GRACE_MS = (Number(process.env.SHIFT_OVERTIME_GRACE_HOURS) || 2) * 3_600_000;

/** End datetime of a shift window; C (end < start) ends next calendar day. */
function shiftEndDateTime(prodDate: Date | string, startTime: string, endTime: string): Date {
  const dateStr = formatDbDate(prodDate);
  const end = endTime.slice(0, 5);
  const start = startTime.slice(0, 5);
  const [eh] = end.split(':').map(Number);
  const [sh] = start.split(':').map(Number);
  const endDate = eh < sh ? addPlantDays(dateStr, 1) : dateStr;
  return plantClockDate(endDate, end);
}

/** Live only until shift end + grace — replaces the flat 1-day calendar window. */
function isSessionLive(session: {
  prod_date: Date | string;
  start_time: string;
  end_time: string;
}): boolean {
  return (
    Date.now() <=
    shiftEndDateTime(session.prod_date, session.start_time, session.end_time).getTime() +
      OVERTIME_GRACE_MS
  );
}

/** @deprecated Prefer isSessionLive / isSessionLiveById (window-aware). */
function isSessionDateLive(prodDate: Date | string): boolean {
  const earliestLive = addPlantDays(currentPlantDate(), -1);
  return formatPlantDate(prodDate) >= earliestLive;
}

export type ShiftOverrideReason =
  | 'OVERTIME'
  | 'PREV_SHIFT_CONTINUATION'
  | 'MACHINE_HEAD_INSTRUCTION'
  | 'SHIFT_CORRECTION'
  | 'OTHER';

export interface DetectedShift {
  shiftCode: string;
  shiftName: string;
  prodDate: string;
  windowStart: string;
  windowEnd: string;
  detectedAt: string;
  source: 'CLOCK' | 'OVERRIDE' | 'SESSION' | 'FALLBACK';
  overrideId?: number;
  overrideReason?: string;
}

/** @deprecated Import resolveShiftFromClock from @m1/shared-validation */
export { resolveShiftFromClock } from '@m1/shared-validation';

function mapShiftWindowRows(
  rows: Array<{ shift_code: string; name: string; start_time: string; end_time: string }>,
): PlantShiftWindow[] {
  return rows.map((r) => ({
    shift_code: r.shift_code,
    name: r.name,
    start_time: String(r.start_time).slice(0, 5),
    end_time: String(r.end_time).slice(0, 5),
  }));
}

async function ensureDefaultShiftWindows(): Promise<void> {
  await db
    .insertInto('master.shift')
    .values(
      DEFAULT_PLANT_SHIFT_WINDOWS.map((w) => ({
        shift_code: w.shift_code,
        name: w.name,
        start_time: w.start_time,
        end_time: w.end_time,
      })),
    )
    .onConflict((oc) => oc.column('shift_code').doNothing())
    .execute();
}

async function loadShiftWindows(): Promise<PlantShiftWindow[]> {
  const rows = await db
    .selectFrom('master.shift')
    .select(['shift_code', 'name', 'start_time', 'end_time'])
    .orderBy('start_time', 'asc')
    .execute();

  if (rows.length > 0) {
    return mapShiftWindowRows(rows);
  }

  await ensureDefaultShiftWindows();

  const reloaded = await db
    .selectFrom('master.shift')
    .select(['shift_code', 'name', 'start_time', 'end_time'])
    .orderBy('start_time', 'asc')
    .execute();

  return reloaded.length > 0 ? mapShiftWindowRows(reloaded) : [...DEFAULT_PLANT_SHIFT_WINDOWS];
}

async function latestOverride(
  userId: number,
  machineCode?: string,
): Promise<{
  override_id: string;
  selected_shift_code: string;
  prod_date: Date;
  reason_code: string;
} | null> {
  let q = db
    .selectFrom('txn.shift_override_audit')
    .select(['override_id', 'selected_shift_code', 'prod_date', 'reason_code', 'created_at'])
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .limit(1);

  if (machineCode) {
    q = q.where((eb) =>
      eb.or([eb('machine_code', '=', machineCode), eb('machine_code', 'is', null)]),
    );
  }

  const row = await q.executeTakeFirst();
  if (!row) return null;

  const ageMs = Date.now() - new Date(row.created_at as Date).getTime();
  if (ageMs > 12 * 60 * 60 * 1000) return null;

  return row as {
    override_id: string;
    selected_shift_code: string;
    prod_date: Date;
    reason_code: string;
  };
}

type SessionRow = {
  shift_code: string;
  shift_name: string;
  prod_date: Date | string;
  start_time: string;
  end_time: string;
  session_id?: string;
};

function sessionMatchesOperational(
  session: { prod_date: Date | string; shift_code: string },
  prodDate: string,
  shiftCode: string,
): boolean {
  return (
    formatDbDate(session.prod_date as Date) === formatPlantDate(prodDate) &&
    String(session.shift_code).toUpperCase() === shiftCode.toUpperCase()
  );
}

/**
 * ACTIVE session for machine (prefer this operator), only if still within
 * shift-end + overtime grace. Stale overnight sessions are ignored.
 * When requireCallerSession is true, never fall back to another operator's session
 * (production writes must use the caller's own pin).
 */
async function findActiveSession(
  machineCode: string,
  userId?: number,
  opts?: { requireCallerSession?: boolean },
): Promise<SessionRow | null> {
  const sessionSelect = () =>
    db
      .selectFrom('txn.machine_shift_session as s')
      .innerJoin('master.shift as w', 'w.shift_code', 's.shift_code')
      .select([
        's.session_id',
        's.shift_code',
        'w.name as shift_name',
        's.prod_date',
        'w.start_time',
        'w.end_time',
      ])
      .where('s.machine_code', '=', machineCode)
      .where('s.status', '=', 'ACTIVE')
      .where('s.prod_date', '>=', postgresDateOnly(addPlantDays(currentPlantDate(), -1)) as any)
      .orderBy('s.started_at', 'desc');

  const live = (row: SessionRow | undefined | null) =>
    row &&
    isSessionLive({
      prod_date: row.prod_date,
      start_time: String(row.start_time).slice(0, 5),
      end_time: String(row.end_time).slice(0, 5),
    })
      ? row
      : null;

  if (userId) {
    const userSession = await sessionSelect()
      .where('s.operator_user_id', '=', userId)
      .executeTakeFirst();
    const r = live(userSession as SessionRow);
    if (r) return r;
    if (opts?.requireCallerSession) return null;
  } else if (opts?.requireCallerSession) {
    return null;
  }

  const activeSession = await sessionSelect().executeTakeFirst();
  return live(activeSession as SessionRow);
}

export class ShiftDetectionService {
  static isSessionDateLive = isSessionDateLive;
  static isSessionLive = isSessionLive;
  static shiftEndDateTime = shiftEndDateTime;
  static sessionMatchesOperational = sessionMatchesOperational;

  /** Join master.shift and apply window-aware liveness. */
  static async isSessionLiveById(sessionId: string): Promise<boolean> {
    const row = await db
      .selectFrom('txn.machine_shift_session as s')
      .innerJoin('master.shift as w', 'w.shift_code', 's.shift_code')
      .select(['s.prod_date', 'w.start_time', 'w.end_time'])
      .where('s.session_id', '=', sessionId)
      .executeTakeFirst();
    if (!row) return false;
    return isSessionLive({
      prod_date: row.prod_date,
      start_time: String(row.start_time).slice(0, 5),
      end_time: String(row.end_time).slice(0, 5),
    });
  }

  /**
   * Close this operator's ACTIVE sessions that are past shift-end + overtime grace.
   * Safe on login — keeps genuine live/overtime sessions open.
   */
  static async closeStaleOperatorSessions(
    machineCode: string,
    operatorUserId: number,
  ): Promise<number> {
    return this.closeStaleSessionsOnMachine(machineCode, operatorUserId);
  }

  /** ACTIVE sessions past shift-end + overtime grace (not yet closed). */
  static async listStaleActiveSessions(machineCode?: string): Promise<
    Array<{
      session_id: string;
      machine_code: string;
      shift_code: string;
      prod_date: Date | string;
      operator_user_id: number;
      shift_log_id: string | null;
    }>
  > {
    let q = db
      .selectFrom('txn.machine_shift_session as s')
      .innerJoin('master.shift as w', 'w.shift_code', 's.shift_code')
      .select([
        's.session_id',
        's.machine_code',
        's.shift_code',
        's.prod_date',
        's.operator_user_id',
        's.shift_log_id',
        'w.start_time',
        'w.end_time',
      ])
      .where('s.status', '=', 'ACTIVE');
    if (machineCode) q = q.where('s.machine_code', '=', machineCode);

    const active = await q.execute();
    return active
      .filter(
        (s) =>
          !isSessionLive({
            prod_date: s.prod_date,
            start_time: String(s.start_time).slice(0, 5),
            end_time: String(s.end_time).slice(0, 5),
          }),
      )
      .map((s) => ({
        session_id: String(s.session_id),
        machine_code: s.machine_code,
        shift_code: String(s.shift_code).toUpperCase(),
        prod_date: s.prod_date,
        operator_user_id: Number(s.operator_user_id),
        shift_log_id: s.shift_log_id != null ? String(s.shift_log_id) : null,
      }));
  }

  /**
   * Close ACTIVE sessions past shift-end + overtime grace.
   * When operatorUserId is omitted, closes stale sessions for any operator on the machine.
   */
  static async closeStaleSessionsOnMachine(
    machineCode: string,
    operatorUserId?: number,
  ): Promise<number> {
    const stale = await this.listStaleActiveSessions(machineCode);
    const toClose = operatorUserId != null
      ? stale.filter((s) => s.operator_user_id === operatorUserId)
      : stale;
    if (toClose.length === 0) return 0;

    await db
      .updateTable('txn.machine_shift_session')
      .set({ status: 'CLOSED', closed_at: new Date() })
      .where(
        'session_id',
        'in',
        toClose.map((s) => s.session_id),
      )
      .execute();

    return toClose.length;
  }

  /** Sweep all machines: close non-live ACTIVE sessions (keeps overtime-grace pins). */
  static async closeAllStaleActiveSessions(): Promise<number> {
    const stale = await this.listStaleActiveSessions();
    if (stale.length === 0) return 0;
    await db
      .updateTable('txn.machine_shift_session')
      .set({ status: 'CLOSED', closed_at: new Date() })
      .where(
        'session_id',
        'in',
        stale.map((s) => s.session_id),
      )
      .execute();
    return stale.length;
  }

  /**
   * Resolve the operator's shift for a machine.
   * Priority: ACTIVE session (any shift — pin until handover) → recent override → wall clock.
   * Without machineCode, returns clock/override only (used by shift-change watcher).
   * Set requireCallerSession for production writes (no borrow of another operator's pin).
   */
  /**
   * Batch SESSION shift codes for live boards — one query instead of per-machine getCurrentShift.
   * Only returns machines with a live ACTIVE session (clock/override omitted; callers fall back).
   */
  static async getSessionShiftCodesForMachines(
    machineCodes: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (machineCodes.length === 0) return out;

    const rows = await db
      .selectFrom('txn.machine_shift_session as s')
      .innerJoin('master.shift as w', 'w.shift_code', 's.shift_code')
      .select([
        's.machine_code',
        's.shift_code',
        's.prod_date',
        'w.start_time',
        'w.end_time',
        's.started_at',
      ])
      .where('s.machine_code', 'in', machineCodes)
      .where('s.status', '=', 'ACTIVE')
      .where('s.prod_date', '>=', postgresDateOnly(addPlantDays(currentPlantDate(), -1)) as any)
      .orderBy('s.started_at', 'desc')
      .execute();

    for (const row of rows) {
      if (out.has(row.machine_code)) continue;
      if (
        isSessionLive({
          prod_date: row.prod_date,
          start_time: String(row.start_time).slice(0, 5),
          end_time: String(row.end_time).slice(0, 5),
        })
      ) {
        out.set(row.machine_code, String(row.shift_code).toUpperCase());
      }
    }
    return out;
  }

  static async getCurrentShift(opts?: {
    userId?: number;
    machineCode?: string;
    requireCallerSession?: boolean;
  }): Promise<DetectedShift> {
    const windows = await loadShiftWindows();
    const at = new Date();
    const clock = resolveShiftFromClock(windows, at);

    // Machine-scoped: ACTIVE session wins even when clock has rolled (C still open after 06:00).
    if (opts?.machineCode) {
      const activeSession = await findActiveSession(opts.machineCode, opts.userId, {
        requireCallerSession: opts.requireCallerSession,
      });
      if (activeSession) {
        return {
          shiftCode: String(activeSession.shift_code).toUpperCase(),
          shiftName: activeSession.shift_name,
          prodDate: formatDbDate(activeSession.prod_date as Date),
          windowStart: String(activeSession.start_time).slice(0, 5),
          windowEnd: String(activeSession.end_time).slice(0, 5),
          detectedAt: at.toISOString(),
          source: 'SESSION',
        };
      }
      if (opts.requireCallerSession) {
        throw new Error(
          'NO_ACTIVE_SESSION: Start or resume your session on this machine before production.',
        );
      }
    }

    let shiftCode = clock.shiftCode;
    let shiftName = clock.shiftName;
    let prodDate = clock.prodDate;
    let windowStart = clock.window.start_time;
    let windowEnd = clock.window.end_time;
    let source: DetectedShift['source'] = 'FALLBACK';
    let overrideId: number | undefined;
    let overrideReason: string | undefined;

    if (opts?.userId) {
      const override = await latestOverride(opts.userId, opts.machineCode);
      if (override) {
        const w = windows.find((x) => x.shift_code === override.selected_shift_code) ?? clock.window;
        shiftCode = override.selected_shift_code;
        shiftName = w.name;
        prodDate = formatDbDate(override.prod_date);
        windowStart = w.start_time;
        windowEnd = w.end_time;
        source = 'OVERRIDE';
        overrideId = Number(override.override_id);
        overrideReason = override.reason_code;
      }
    }

    return {
      shiftCode,
      shiftName,
      prodDate,
      windowStart,
      windowEnd,
      detectedAt: at.toISOString(),
      source,
      overrideId,
      overrideReason,
    };
  }

  /**
   * Single source of truth for shift-log resolution.
   * Prefer ACTIVE session (machineCode) over explicit planDate/shiftCode over wall clock.
   * Idempotently creates the shift_log row when missing.
   */
  static async resolveShift(opts: {
    machineCode?: string;
    planDate?: string | Date;
    shiftCode?: string;
    orderId?: string;
    clock?: Date;
    userId?: number;
    processId?: number;
    /** When true with machineCode, do not borrow another operator's ACTIVE session. */
    requireCallerSession?: boolean;
  }): Promise<{ shiftLogId: string; shiftCode: string; prodDate: string; processId: number }> {
    const { ShiftLogService } = await import('./shiftLogService');
    const { parseDateOnly } = await import('../utils/dateOnly');

    // Order already attributed — honor it unless caller forced plan/session.
    if (opts.orderId && !opts.machineCode && !opts.planDate && !opts.shiftCode) {
      const order = await db
        .selectFrom('txn.crm_order')
        .select(['shift_log_id', 'prod_date', 'shift_code'])
        .where('order_id', '=', opts.orderId)
        .executeTakeFirst();
      if (!order) {
        throw new Error(`Order ${opts.orderId} not found`);
      }
      if (order.shift_log_id) {
        const log = await db
          .selectFrom('txn.shift_log')
          .select(['shift_log_id', 'shift_code', 'prod_date', 'process_id'])
          .where('shift_log_id', '=', order.shift_log_id)
          .executeTakeFirstOrThrow();
        return {
          shiftLogId: String(log.shift_log_id),
          shiftCode: String(log.shift_code).toUpperCase(),
          prodDate: formatDbDate(log.prod_date as Date),
          processId: log.process_id,
        };
      }
      if (order.prod_date && order.shift_code) {
        opts = {
          ...opts,
          planDate: order.prod_date,
          shiftCode: order.shift_code,
        };
      } else {
        throw new Error(`Order ${opts.orderId} has no shift attribution`);
      }
    }

    let processId = opts.processId;
    if (processId == null) {
      const { resolveRollingProcessId } = await import('../utils/rollingProcess');
      processId = await resolveRollingProcessId();
    }

    let shiftCode: string;
    let prodDate: string;

    if (opts.machineCode) {
      const detected = await this.getCurrentShift({
        userId: opts.userId,
        machineCode: opts.machineCode,
        requireCallerSession: opts.requireCallerSession,
      });
      shiftCode = detected.shiftCode.toUpperCase();
      prodDate = detected.prodDate;
    } else if (opts.planDate && opts.shiftCode) {
      shiftCode = opts.shiftCode.toUpperCase();
      prodDate =
        typeof opts.planDate === 'string'
          ? formatPlantDate(opts.planDate)
          : formatDbDate(opts.planDate);
    } else {
      const windows = await loadShiftWindows();
      const { resolveBoundaryShifts } = await import('./ShiftBoundaryService');
      const boundary = resolveBoundaryShifts(windows, opts.clock ?? new Date());
      shiftCode = boundary.incomingShiftCode;
      prodDate = boundary.incomingProdDate;
    }

    const shiftLogId = String(
      await ShiftLogService.create({
        processId,
        productionDate: parseDateOnly(prodDate),
        shiftCode,
        supervisorId: opts.userId ?? 1,
      }),
    );

    return { shiftLogId, shiftCode, prodDate, processId };
  }

  static async recordOverride(input: {
    userId: number;
    selectedShiftCode: string;
    prodDate: string;
    reasonCode: ShiftOverrideReason;
    reasonDetail?: string;
    machineCode?: string;
  }): Promise<DetectedShift> {
    const row = await db
      .insertInto('txn.shift_override_audit')
      .values({
        user_id: input.userId,
        machine_code: input.machineCode ?? null,
        selected_shift_code: input.selectedShiftCode,
        prod_date: postgresDateOnly(input.prodDate),
        reason_code: input.reasonCode,
        reason_detail: input.reasonDetail?.trim() || null,
      })
      .returning(['override_id', 'selected_shift_code', 'prod_date', 'reason_code'])
      .executeTakeFirstOrThrow();

    await db
      .insertInto('txn.shift_event_audit')
      .values({
        event_type: 'SHIFT_OVERRIDE',
        entity_type: 'shift_override_audit',
        entity_id: String(row.override_id),
        machine_code: input.machineCode ?? null,
        user_id: input.userId,
        payload: {
          selectedShiftCode: input.selectedShiftCode,
          prodDate: input.prodDate,
          reasonCode: input.reasonCode,
          reasonDetail: input.reasonDetail ?? null,
        },
      })
      .execute();

    return this.getCurrentShift({ userId: input.userId, machineCode: input.machineCode });
  }

  static async listShiftWindows() {
    return loadShiftWindows();
  }

  static async updateShiftWindow(
    shiftCode: string,
    startTime: string,
    endTime: string,
    userId: number,
  ) {
    const normalized = shiftCode.toUpperCase();
    const start = startTime.slice(0, 5);
    const end = endTime.slice(0, 5);

    await db
      .updateTable('master.shift')
      .set({ start_time: start, end_time: end })
      .where('shift_code', '=', normalized)
      .execute();

    await db
      .insertInto('txn.shift_event_audit')
      .values({
        event_type: 'SHIFT_WINDOW_UPDATED',
        entity_type: 'master.shift',
        entity_id: normalized,
        user_id: userId,
        payload: { startTime: start, endTime: end },
      })
      .execute();

    return loadShiftWindows();
  }

  static async listShiftAudit(opts?: { limit?: number; eventType?: string }) {
    const limit = opts?.limit ?? 50;
    let q = db
      .selectFrom('txn.shift_event_audit as e')
      .leftJoin('security.app_user as u', 'u.user_id', 'e.user_id')
      .select([
        'e.event_id',
        'e.event_type',
        'e.entity_type',
        'e.entity_id',
        'e.machine_code',
        'e.payload',
        'e.created_at',
        'u.username',
      ])
      .orderBy('e.created_at', 'desc')
      .limit(limit);

    if (opts?.eventType) {
      q = q.where('e.event_type', '=', opts.eventType);
    }

    const rows = await q.execute();
    return rows.map((r) => ({
      eventId: String(r.event_id),
      eventType: r.event_type,
      entityType: r.entity_type ?? undefined,
      entityId: r.entity_id ?? undefined,
      machineCode: r.machine_code ?? undefined,
      username: r.username ?? undefined,
      payload: r.payload,
      createdAt: new Date(r.created_at as Date).toISOString(),
    }));
  }
}
