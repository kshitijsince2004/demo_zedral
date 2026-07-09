import { sql } from 'kysely';
import type { OrderRejectionInfo } from '@m1/shared-validation';
import { db } from '../db';

export async function loadOrderRejection(orderId: number | string): Promise<OrderRejectionInfo | undefined> {
  const row = await db
    .selectFrom('txn.order_rejection as rej')
    .leftJoin('security.app_user as u', 'u.user_id', 'rej.operator_id')
    .select([
      'rej.rejection_reason',
      'rej.remarks',
      'rej.defect_codes',
      'rej.created_at',
      sql<string>`COALESCE(u.full_name, 'Unknown')`.as('rejected_by'),
    ])
    .where('rej.order_id', '=', String(orderId))
    .orderBy('rej.created_at', 'desc')
    .executeTakeFirst();

  if (!row) return undefined;

  let defectCodes: string[] | undefined;
  if (row.defect_codes) {
    const raw = row.defect_codes;
    defectCodes = typeof raw === 'string' ? JSON.parse(raw) : (raw as string[]);
  }

  return {
    reason: row.rejection_reason,
    rejectedAt: new Date(row.created_at).toISOString(),
    rejectedBy: row.rejected_by,
    remarks: row.remarks ?? undefined,
    defectCodes,
  };
}
