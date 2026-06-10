import { db } from '../db';

const PLANT_TZ = 'Asia/Kolkata';

export type ShiftOverrideReason =
  | 'OVERTIME'
  | 'PREV_SHIFT_CONTINUATION'
  | 'SUPERVISOR_INSTRUCTION'
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

interface ShiftWindow {
  shift_code: string;
  name: string;
  start_time: string;
  end_time: string;
}

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function istNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: PLANT_TZ }));
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function minutesNow(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Resolve active shift from master.shift windows (supports overnight Shift C). */
export function resolveShiftFromClock(
  windows: ShiftWindow[],
  at: Date = istNow(),
): { shiftCode: string; shiftName: string; prodDate: string; window: ShiftWindow } {
  const nowMin = minutesNow(at);
  const today = formatDate(at);
  const yesterday = formatDate(new Date(at.getTime() - 86400000));

  for (const w of windows) {
    const start = parseTimeToMinutes(w.start_time);
    const end = parseTimeToMinutes(w.end_time);
    const overnight = end <= start;

    if (overnight) {
      if (nowMin >= start) {
        return { shiftCode: w.shift_code, shiftName: w.name, prodDate: today, window: w };
      }
      if (nowMin < end) {
        return { shiftCode: w.shift_code, shiftName: w.name, prodDate: yesterday, window: w };
      }
    } else if (nowMin >= start && nowMin < end) {
      return { shiftCode: w.shift_code, shiftName: w.name, prodDate: today, window: w };
    }
  }

  const fallback = windows[0];
  return {
    shiftCode: fallback?.shift_code ?? 'A',
    shiftName: fallback?.name ?? 'Shift A',
    prodDate: today,
    window: fallback,
  };
}

async function loadShiftWindows(): Promise<ShiftWindow[]> {
  const rows = await db
    .selectFrom('master.shift')
    .select(['shift_code', 'name', 'start_time', 'end_time'])
    .orderBy('start_time', 'asc')
    .execute();
  return rows.map((r) => ({
    shift_code: r.shift_code,
    name: r.name,
    start_time: String(r.start_time).slice(0, 5),
    end_time: String(r.end_time).slice(0, 5),
  }));
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

export class ShiftDetectionService {
  static async getCurrentShift(opts?: {
    userId?: number;
    machineCode?: string;
  }): Promise<DetectedShift> {
    const windows = await loadShiftWindows();
    const at = istNow();

    if (opts?.machineCode) {
      const activeSession = await db
        .selectFrom('txn.machine_shift_session as s')
        .innerJoin('master.shift as w', 'w.shift_code', 's.shift_code')
        .select(['s.shift_code', 'w.name as shift_name', 's.prod_date', 'w.start_time', 'w.end_time'])
        .where('s.machine_code', '=', opts.machineCode)
        .where('s.status', '=', 'ACTIVE')
        .executeTakeFirst();
      
      if (activeSession) {
        return {
          shiftCode: activeSession.shift_code,
          shiftName: activeSession.shift_name,
          prodDate: formatDate(new Date(activeSession.prod_date as Date)),
          windowStart: activeSession.start_time.slice(0, 5),
          windowEnd: activeSession.end_time.slice(0, 5),
          detectedAt: at.toISOString(),
          source: 'SESSION',
        };
      }
    }

    const detected = resolveShiftFromClock(windows, at);

    if (opts?.userId) {
      const override = await latestOverride(opts.userId, opts.machineCode);
      if (override) {
        const w = windows.find((x) => x.shift_code === override.selected_shift_code) ?? detected.window;
        return {
          shiftCode: override.selected_shift_code,
          shiftName: w.name,
          prodDate: formatDate(new Date(override.prod_date)),
          windowStart: w.start_time,
          windowEnd: w.end_time,
          detectedAt: at.toISOString(),
          source: 'OVERRIDE',
          overrideId: Number(override.override_id),
          overrideReason: override.reason_code,
        };
      }
    }

    // Default to clock (which is considered FALLBACK now since we removed auto shift logic)
    return {
      shiftCode: detected.shiftCode,
      shiftName: detected.shiftName,
      prodDate: detected.prodDate,
      windowStart: detected.window.start_time,
      windowEnd: detected.window.end_time,
      detectedAt: at.toISOString(),
      source: 'FALLBACK',
    };
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
        prod_date: input.prodDate,
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
