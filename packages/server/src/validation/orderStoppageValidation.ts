import { db } from '../db';
import {
  assertEndAfterStart,
  assertNoOverlappingIntervals,
  assertStoppageStartWithinShift,
  ManufacturingValidationError,
  resolveShiftFromInstant,
  resolveShiftWindowBounds,
  stoppageStartWithinShift,
} from './manufacturingValidation';
import { parsePlantDateOnly } from '@m1/shared-validation';

function localCalendarDate(value: Date | string): Date {
  return parsePlantDateOnly(value);
}

async function loadMasterShiftWindows() {
  const rows = await db
    .selectFrom('master.shift')
    .select(['shift_code', 'start_time', 'end_time'])
    .orderBy('start_time', 'asc')
    .execute();

  return rows.map((row) => ({
    shift_code: row.shift_code,
    start_time: String(row.start_time).slice(0, 5),
    end_time: String(row.end_time).slice(0, 5),
  }));
}

/** Production shift for an order: shift_log → crm6_order (never PPC plan_date). */
async function loadOrderShiftContext(orderId: string | number) {
  const row = await db
    .selectFrom('txn.crm_order as o')
    .leftJoin('txn.shift_log as sl', 'sl.shift_log_id', 'o.shift_log_id')
    .select([
      'sl.prod_date as sl_prod_date',
      'sl.shift_code as sl_shift_code',
      'o.prod_date as o_prod_date',
      'o.shift_code as o_shift_code',
    ])
    .where('o.order_id', '=', String(orderId))
    .executeTakeFirst();

  const shiftCode = row?.sl_shift_code ?? row?.o_shift_code;
  const prodDateRaw = row?.sl_prod_date ?? row?.o_prod_date;
  if (!shiftCode || !prodDateRaw) return null;

  const shiftRow = await db
    .selectFrom('master.shift')
    .select(['start_time', 'end_time'])
    .where('shift_code', '=', String(shiftCode).trim())
    .executeTakeFirst();

  if (!shiftRow?.start_time || !shiftRow?.end_time) return null;

  const prodDate = localCalendarDate(
    prodDateRaw instanceof Date ? prodDateRaw : String(prodDateRaw),
  );

  return resolveShiftWindowBounds(
    prodDate,
    String(shiftRow.start_time).slice(0, 5),
    String(shiftRow.end_time).slice(0, 5),
  );
}

async function loadOrderStoppages(orderId: string | number, excludeStoppageId?: string) {
  let q = db
    .selectFrom('txn.stoppage')
    .select(['stoppage_id', 'start_at', 'end_at'])
    .where('order_id', '=', String(orderId));

  if (excludeStoppageId) {
    q = q.where('stoppage_id', '!=', excludeStoppageId);
  }

  return q.execute();
}

export async function assertCanStartOrderStoppage(orderId: string | number): Promise<void> {
  const open = await db
    .selectFrom('txn.stoppage')
    .select(db.fn.count('stoppage_id').as('c'))
    .where('order_id', '=', String(orderId))
    .where('end_at', 'is', null)
    .executeTakeFirst();

  if (Number(open?.c ?? 0) > 0) {
    throw new ManufacturingValidationError('A stoppage is already active on this order');
  }
}

export async function validateOrderStoppageStart(
  orderId: string | number,
  startAt: Date,
): Promise<void> {
  const existing = await loadOrderStoppages(orderId);
  for (const s of existing) {
    if (!s.end_at) continue;
    const prevEnd = new Date(s.end_at);
    if (startAt.getTime() < prevEnd.getTime()) {
      throw new ManufacturingValidationError('Stoppage start overlaps a previous stoppage on this order');
    }
    const prevStart = new Date(s.start_at);
    if (startAt.getTime() >= prevStart.getTime() && startAt.getTime() < prevEnd.getTime()) {
      throw new ManufacturingValidationError('Stoppage start overlaps a previous stoppage on this order');
    }
  }

  const attributed = await loadOrderShiftContext(orderId);
  if (attributed && stoppageStartWithinShift(startAt, attributed.start, attributed.end)) {
    return;
  }

  const windows = await loadMasterShiftWindows();
  const detected = resolveShiftFromInstant(windows, startAt);
  if (detected) {
    const clockBounds = resolveShiftWindowBounds(
      detected.prodDate,
      detected.startTime,
      detected.endTime,
    );
    if (stoppageStartWithinShift(startAt, clockBounds.start, clockBounds.end)) {
      return;
    }
  }

  if (attributed) {
    assertStoppageStartWithinShift(startAt, attributed.start, attributed.end);
  }
}

export async function validateOrderStoppageInterval(
  orderId: string | number,
  startAt: Date,
  endAt: Date,
  excludeStoppageId?: string,
): Promise<void> {
  assertEndAfterStart(startAt, endAt, 'Stoppage');

  const existing = await loadOrderStoppages(orderId, excludeStoppageId);
  const intervals = [
    ...existing
      .filter((s) => s.end_at)
      .map((s) => ({
        start: new Date(s.start_at),
        end: new Date(s.end_at!),
        label: String(s.stoppage_id),
      })),
    { start: startAt, end: endAt, label: 'new' },
  ];
  assertNoOverlappingIntervals(intervals);
}

