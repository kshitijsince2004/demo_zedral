import { db } from '../db';
import {
  DEFAULT_PLANT_SHIFT_WINDOWS,
  formatDbDate,
  formatPlantDate,
  postgresDateOnly,
  resolveShiftFromClock,
  type PlantShiftWindow,
} from '@m1/shared-validation';

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

/** @deprecated Import DEFAULT_PLANT_SHIFT_WINDOWS from @m1/shared-validation */
export const DEFAULT_SHIFT_WINDOWS = DEFAULT_PLANT_SHIFT_WINDOWS;

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

export class ShiftDetectionService {
  static async getCurrentShift(opts?: {
    userId?: number;
    machineCode?: string;
  }): Promise<DetectedShift> {
    const windows = await loadShiftWindows();
    const at = new Date();

    if (opts?.machineCode) {
      const sessionSelect = () =>
        db
          .selectFrom('txn.machine_shift_session as s')
          .innerJoin('master.shift as w', 'w.shift_code', 's.shift_code')
          .select([
            's.shift_code',
            'w.name as shift_name',
            's.prod_date',
            'w.start_time',
            'w.end_time',
          ]);

      if (opts.userId) {
        const userSession = await sessionSelect()
          .where('s.machine_code', '=', opts.machineCode)
          .where('s.operator_user_id', '=', opts.userId)
          .where('s.status', '=', 'ACTIVE')
          .orderBy('s.started_at', 'desc')
          .executeTakeFirst();

        if (userSession) {
          return {
            shiftCode: userSession.shift_code,
            shiftName: userSession.shift_name,
            prodDate: formatDbDate(userSession.prod_date as Date),
            windowStart: String(userSession.start_time).slice(0, 5),
            windowEnd: String(userSession.end_time).slice(0, 5),
            detectedAt: at.toISOString(),
            source: 'SESSION',
          };
        }
      }

      const activeSession = await sessionSelect()
        .where('s.machine_code', '=', opts.machineCode)
        .where('s.status', '=', 'ACTIVE')
        .orderBy('s.started_at', 'desc')
        .executeTakeFirst();

      if (activeSession) {
        return {
          shiftCode: activeSession.shift_code,
          shiftName: activeSession.shift_name,
          prodDate: formatDbDate(activeSession.prod_date as Date),
          windowStart: String(activeSession.start_time).slice(0, 5),
          windowEnd: String(activeSession.end_time).slice(0, 5),
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
          prodDate: formatDbDate(override.prod_date),
          windowStart: w.start_time,
          windowEnd: w.end_time,
          detectedAt: at.toISOString(),
          source: 'OVERRIDE',
          overrideId: Number(override.override_id),
          overrideReason: override.reason_code,
        };
      }
    }

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
