import { db } from '../db';
import {
  assertEndAfterStart,
  assertNoOverlappingIntervals,
  assertWithinShiftWindow,
  ManufacturingValidationError,
  resolveShiftWindowBounds,
} from './manufacturingValidation';

async function loadOrderShiftContext(orderId: string | number) {
  const row = await db
    .selectFrom('txn.crm6_order as o')
    .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
    .leftJoin('master.shift as s', 's.shift_code', 'pb.shift_code')
    .select([
      'pb.plan_date',
      'pb.shift_code',
      's.start_time',
      's.end_time',
    ])
    .where('o.order_id', '=', String(orderId))
    .executeTakeFirst();

  if (!row?.start_time || !row?.end_time) {
    return null;
  }

  const prodDate = row.plan_date instanceof Date ? row.plan_date : new Date(row.plan_date);
  return resolveShiftWindowBounds(
    prodDate,
    String(row.start_time).slice(0, 5),
    String(row.end_time).slice(0, 5),
  );
}

async function loadOrderStoppages(orderId: string | number, excludeStoppageId?: string) {
  let q = db
    .selectFrom('txn.order_stoppage')
    .select(['stoppage_id', 'start_at', 'end_at'])
    .where('order_id', '=', String(orderId));

  if (excludeStoppageId) {
    q = q.where('stoppage_id', '!=', excludeStoppageId);
  }

  return q.execute();
}

export async function assertCanStartOrderStoppage(orderId: string | number): Promise<void> {
  const open = await db
    .selectFrom('txn.order_stoppage')
    .select(db.fn.count('stoppage_id').as('c'))
    .where('order_id', '=', String(orderId))
    .where('end_at', 'is', null)
    .executeTakeFirst();

  if (Number(open?.c ?? 0) > 0) {
    throw new ManufacturingValidationError('A stoppage is already active on this order');
  }
}

export async function validateOrderStoppageInterval(
  orderId: string | number,
  startAt: Date,
  endAt: Date,
  excludeStoppageId?: string,
): Promise<void> {
  assertEndAfterStart(startAt, endAt, 'Stoppage');

  const shift = await loadOrderShiftContext(orderId);
  if (shift) {
    assertWithinShiftWindow(startAt, endAt, shift.start, shift.end);
  }

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
