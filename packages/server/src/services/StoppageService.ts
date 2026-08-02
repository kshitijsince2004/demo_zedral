import { db } from '../db';
import { calculateStoppageDuration } from '@m1/shared-validation';
import {
  assertEndAfterStart,
  assertNoOverlappingIntervals,
  assertRuntimeAccounting,
  ManufacturingValidationError,
  resolveShiftWindowBounds,
} from '../validation/manufacturingValidation';
import { publishDowntimeLogged } from '../platform/m1Events';
import { plantClockDate } from '@m1/shared-validation';

function clockTimeToDate(prodDate: Date, time: string): Date {
  return plantClockDate(prodDate, time);
}

export class StoppageService {
  static async create(payload: {
    shiftLogId: string;
    stoppageCode: string;
    fromTime?: string;
    startTime?: string;
    toTime?: string;
    endTime?: string;
    durationMins?: number;
    remarks?: string;
  }, userId: string) {
    const fromTime = payload.fromTime ?? payload.startTime;
    const toTime = payload.toTime ?? payload.endTime;

    if (!payload.shiftLogId) throw new ManufacturingValidationError('shiftLogId is required');
    if (!payload.stoppageCode) throw new ManufacturingValidationError('stoppageCode is required');
    if (!fromTime) throw new ManufacturingValidationError('fromTime is required');
    if (!toTime) throw new ManufacturingValidationError('toTime is required');

    const shiftLog = await db
      .selectFrom('txn.shift_log as sl')
      .leftJoin('master.shift as s', 's.shift_code', 'sl.shift_code')
      .select(['sl.prod_date', 'sl.shift_code', 's.start_time', 's.end_time', 'sl.tenant_id'])
      .where('sl.shift_log_id', '=', payload.shiftLogId)
      .executeTakeFirst();

    if (!shiftLog) throw new ManufacturingValidationError('Shift log not found');

    const prodDate = shiftLog.prod_date instanceof Date ? shiftLog.prod_date : new Date(shiftLog.prod_date);
    
    // Resolve full Timestamps for the stoppage
    const startAt = clockTimeToDate(prodDate, fromTime);
    let endAt = clockTimeToDate(prodDate, toTime);
    if (endAt.getTime() <= startAt.getTime()) {
      endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
    }

    assertEndAfterStart(startAt, endAt, 'Stoppage');

    const durationMin =
      payload.durationMins ?? Math.round((endAt.getTime() - startAt.getTime()) / 60000);

    if (durationMin <= 0) {
      throw new ManufacturingValidationError('Stoppage duration must be greater than zero');
    }

    const shiftBounds = shiftLog.start_time && shiftLog.end_time
      ? resolveShiftWindowBounds(prodDate, String(shiftLog.start_time).slice(0, 5), String(shiftLog.end_time).slice(0, 5))
      : null;

    // Fetch stoppage category for Model B alignment
    const category = await db
      .selectFrom('master.stoppage_code')
      .select('category')
      .where('stoppage_code', '=', payload.stoppageCode)
      .executeTakeFirstOrThrow();

    if (shiftBounds) {
      const existing = await db
        .selectFrom('txn.stoppage')
        .select(['start_at', 'end_at', 'duration_min'])
        .where('shift_log_id', '=', payload.shiftLogId)
        .execute();

      const open = existing.filter((e) => !e.end_at);
      if (open.length > 0) {
        throw new ManufacturingValidationError('An active stoppage entry already exists for this shift log');
      }

      const intervals = [
        ...existing
          .filter((e) => e.end_at)
          .map((e) => ({ start: e.start_at, end: e.end_at! })),
        { start: startAt, end: endAt },
      ];
      assertNoOverlappingIntervals(intervals);

      const existingMinutes = existing.reduce((sum, e) => {
        if (!e.end_at) return sum;
        return sum + (e.duration_min ?? Math.round((e.end_at.getTime() - e.start_at.getTime()) / 60000));
      }, 0);
      assertRuntimeAccounting(0, existingMinutes + durationMin, shiftBounds.durationMinutes);
    }

    const row = await db
      .insertInto('txn.stoppage')
      .values({
        tenant_id: shiftLog.tenant_id,
        shift_log_id: payload.shiftLogId,
        category_code: category.category,
        breakdown_code: payload.stoppageCode,
        start_at: startAt,
        end_at: endAt,
        duration_min: durationMin,
        remarks: payload.remarks ?? null,
        shift_code: shiftLog.shift_code,
        prod_date: prodDate,
        operator_id: Number(userId),
      })
      .returning(['stoppage_id'])
      .executeTakeFirstOrThrow();

    void publishDowntimeLogged({
      stoppageId: String(row.stoppage_id),
      shiftLogId: payload.shiftLogId,
      stoppageCode: payload.stoppageCode,
      fromTime,
      toTime,
      durationMin,
      prodDate,
    }).catch((error) => {
      console.error('[M1] failed to publish downtime.logged', error);
    });

    return String(row.stoppage_id);
  }

  /** Open stoppage (no end yet) — process rail Stoppage enter. */
  static async startOpen(payload: {
    shiftLogId: string;
    stoppageCode: string;
    remarks?: string;
    machineCode?: string;
  }, userId: string) {
    if (!payload.shiftLogId) throw new ManufacturingValidationError('shiftLogId is required');
    if (!payload.stoppageCode) throw new ManufacturingValidationError('stoppageCode is required');

    const shiftLog = await db
      .selectFrom('txn.shift_log as sl')
      .select(['sl.prod_date', 'sl.shift_code', 'sl.tenant_id'])
      .where('sl.shift_log_id', '=', payload.shiftLogId)
      .executeTakeFirst();
    if (!shiftLog) throw new ManufacturingValidationError('Shift log not found');

    const open = await db
      .selectFrom('txn.stoppage')
      .select('stoppage_id')
      .where('shift_log_id', '=', payload.shiftLogId)
      .where('end_at', 'is', null)
      .executeTakeFirst();
    if (open) throw new ManufacturingValidationError('An active stoppage entry already exists for this shift log');

    // ponytail: category_code FK → master.stoppage_category (01–16); breakdown optional → stoppage_code
    const raw = String(payload.stoppageCode || '12').trim();
    const padded = /^\d{1,2}$/.test(raw) ? raw.padStart(2, '0') : raw;
    let categoryCode =
      (await db
        .selectFrom('master.stoppage_category')
        .select('category_code')
        .where('category_code', '=', padded)
        .executeTakeFirst())?.category_code ?? null;

    let breakdownCode: string | null =
      (await db
        .selectFrom('master.stoppage_code')
        .select('stoppage_code')
        .where('stoppage_code', '=', raw)
        .executeTakeFirst())?.stoppage_code ?? null;

    if (!categoryCode && breakdownCode) {
      const bucket = await db
        .selectFrom('master.stoppage_code')
        .select('category')
        .where('stoppage_code', '=', breakdownCode)
        .executeTakeFirst();
      const map: Record<string, string> = { MECH: '01', ELECT: '02', OPN: '12' };
      categoryCode = map[String(bucket?.category ?? '')] ?? '12';
    }
    if (!categoryCode) categoryCode = '12';
    if (!breakdownCode && payload.machineCode) {
      breakdownCode =
        (await db
          .selectFrom('master.stoppage_code')
          .select('stoppage_code')
          .where('stoppage_code', 'like', `${payload.machineCode}-%`)
          .orderBy('stoppage_code', 'asc')
          .executeTakeFirst())?.stoppage_code ?? null;
    }

    const prodDate = shiftLog.prod_date instanceof Date ? shiftLog.prod_date : new Date(shiftLog.prod_date);
    const startAt = new Date();
    const row = await db
      .insertInto('txn.stoppage')
      .values({
        tenant_id: shiftLog.tenant_id,
        shift_log_id: payload.shiftLogId,
        category_code: categoryCode,
        breakdown_code: breakdownCode,
        start_at: startAt,
        end_at: null,
        duration_min: null,
        remarks: payload.remarks ?? null,
        shift_code: shiftLog.shift_code,
        prod_date: prodDate,
        operator_id: Number(userId),
        machine_code: payload.machineCode ?? null,
      } as never)
      .returning(['stoppage_id'])
      .executeTakeFirstOrThrow();

    return String(row.stoppage_id);
  }

  static async endOpen(stoppageId: string) {
    const row = await db
      .selectFrom('txn.stoppage')
      .select(['stoppage_id', 'start_at', 'end_at', 'shift_log_id', 'breakdown_code'])
      .where('stoppage_id', '=', stoppageId)
      .executeTakeFirst();
    if (!row) throw new ManufacturingValidationError('Stoppage not found');
    if (row.end_at) return String(row.stoppage_id);

    const endAt = new Date();
    const startAt = new Date(row.start_at);
    const durationMin = Math.max(1, Math.round((endAt.getTime() - startAt.getTime()) / 60000));
    await db
      .updateTable('txn.stoppage')
      .set({ end_at: endAt, duration_min: durationMin })
      .where('stoppage_id', '=', stoppageId)
      .execute();

    const clock = (d: Date) =>
      d.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata',
      });
    const shiftLog = await db
      .selectFrom('txn.shift_log')
      .select('prod_date')
      .where('shift_log_id', '=', String(row.shift_log_id))
      .executeTakeFirst();
    const prodDate = shiftLog?.prod_date instanceof Date
      ? shiftLog.prod_date
      : new Date(String(shiftLog?.prod_date ?? endAt));

    void publishDowntimeLogged({
      stoppageId: String(row.stoppage_id),
      shiftLogId: String(row.shift_log_id),
      stoppageCode: String(row.breakdown_code ?? ''),
      fromTime: clock(startAt),
      toTime: clock(endAt),
      durationMin,
      prodDate,
    }).catch((error) => {
      console.error('[M1] failed to publish downtime.logged', error);
    });

    return String(row.stoppage_id);
  }
}
