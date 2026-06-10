import { db } from '../db';
import { calculateStoppageDuration } from '@m1/shared-validation';
import {
  assertEndAfterStart,
  assertNoOverlappingIntervals,
  assertRuntimeAccounting,
  clockRangeMinutes,
  ManufacturingValidationError,
  resolveShiftWindowBounds,
} from '../validation/manufacturingValidation';

function parseTimeToDate(time: string): Date {
  return new Date(`1970-01-01T${time}`);
}

function clockTimeToDate(prodDate: Date, time: string): Date {
  const [h, m] = time.trim().slice(0, 5).split(':').map(Number);
  return new Date(prodDate.getFullYear(), prodDate.getMonth(), prodDate.getDate(), h ?? 0, m ?? 0, 0, 0);
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
  }, _userId: string) {
    const fromTime = payload.fromTime ?? payload.startTime;
    const toTime = payload.toTime ?? payload.endTime;

    if (!payload.shiftLogId) throw new ManufacturingValidationError('shiftLogId is required');
    if (!payload.stoppageCode) throw new ManufacturingValidationError('stoppageCode is required');
    if (!fromTime) throw new ManufacturingValidationError('fromTime is required');
    if (!toTime) throw new ManufacturingValidationError('toTime is required');

    assertEndAfterStart(parseTimeToDate(fromTime), parseTimeToDate(toTime), 'Stoppage');

    const durationMin =
      payload.durationMins ??
      calculateStoppageDuration(parseTimeToDate(fromTime), parseTimeToDate(toTime));

    if (durationMin <= 0) {
      throw new ManufacturingValidationError('Stoppage duration must be greater than zero');
    }

    const shiftLog = await db
      .selectFrom('txn.shift_log as sl')
      .leftJoin('master.shift as s', 's.shift_code', 'sl.shift_code')
      .select(['sl.prod_date', 'sl.shift_code', 's.start_time', 's.end_time'])
      .where('sl.shift_log_id', '=', payload.shiftLogId)
      .executeTakeFirst();

    if (!shiftLog) throw new ManufacturingValidationError('Shift log not found');

    const prodDate = shiftLog.prod_date instanceof Date ? shiftLog.prod_date : new Date(shiftLog.prod_date);
    const shiftBounds = shiftLog.start_time && shiftLog.end_time
      ? resolveShiftWindowBounds(prodDate, String(shiftLog.start_time).slice(0, 5), String(shiftLog.end_time).slice(0, 5))
      : null;

    if (shiftBounds) {
      const entryStart = clockTimeToDate(prodDate, fromTime);
      let entryEnd = clockTimeToDate(prodDate, toTime);
      if (entryEnd.getTime() <= entryStart.getTime()) {
        entryEnd = new Date(entryEnd.getTime() + 24 * 60 * 60 * 1000);
      }

      const existing = await db
        .selectFrom('txn.stoppage_entry')
        .select(['time_from', 'time_to'])
        .where('shift_log_id', '=', payload.shiftLogId)
        .execute();

      const open = existing.filter((e) => !e.time_to);
      if (open.length > 0) {
        throw new ManufacturingValidationError('An active stoppage entry already exists for this shift log');
      }

      const intervals = [
        ...existing
          .filter((e) => e.time_to)
          .map((e) => {
            const start = clockTimeToDate(prodDate, e.time_from);
            let end = clockTimeToDate(prodDate, e.time_to!);
            if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
            return { start, end };
          }),
        { start: entryStart, end: entryEnd },
      ];
      assertNoOverlappingIntervals(intervals);

      const existingMinutes = existing.reduce((sum, e) => {
        if (!e.time_to) return sum;
        return sum + clockRangeMinutes(e.time_from, e.time_to);
      }, 0);
      assertRuntimeAccounting(0, existingMinutes + durationMin, shiftBounds.durationMinutes);
    }

    const row = await db
      .insertInto('txn.stoppage_entry')
      .values({
        shift_log_id: payload.shiftLogId,
        stoppage_code: payload.stoppageCode,
        time_from: fromTime,
        time_to: toTime,
        duration_min: durationMin,
        remarks: payload.remarks ?? null,
        shift_code: shiftLog.shift_code,
        prod_date: prodDate,
      })
      .returning('stoppage_id')
      .executeTakeFirstOrThrow();

    return String(row.stoppage_id);
  }
}
