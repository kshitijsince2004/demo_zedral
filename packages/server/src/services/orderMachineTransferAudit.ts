import { sql, type Transaction } from 'kysely';
import { db } from '../db';
import type { DB } from '../db-types';

export type OrderMachineTransferRow = {
  transferId: string;
  batchNumber: string;
  fromMachine: string;
  toMachine: string;
  subProcess: string;
  reason?: string;
  assignedBy: string;
  transferredAt: string;
  transferType: string;
};

export async function recordOrderMachineTransfer(
  input: {
    orderId?: number | null;
    batchNumber: string;
    sourceMachine: string;
    destinationMachine: string;
    subProcess: string;
    assignedBy: number;
    reason?: string;
    transferType?: 'SINGLE' | 'BULK';
  },
  trx?: Transaction<DB>,
): Promise<void> {
  const executor = trx ?? db;
  await sql`
    INSERT INTO txn.order_machine_transfer (
      order_id, batch_number, source_machine_code, destination_machine_code,
      sub_process, assigned_by, reason, transfer_type
    ) VALUES (
      ${input.orderId ?? null},
      ${input.batchNumber},
      ${input.sourceMachine},
      ${input.destinationMachine},
      ${input.subProcess},
      ${input.assignedBy},
      ${input.reason?.trim() || null},
      ${input.transferType ?? 'SINGLE'}
    )
  `.execute(executor);
}

function mapTransferRows(rows: {
  transfer_id: string;
  batch_number: string;
  source_machine_code: string;
  destination_machine_code: string;
  sub_process: string;
  reason: string | null;
  transferred_at: Date;
  assigned_by_name: string | null;
  transfer_type: string;
}[]): OrderMachineTransferRow[] {
  return rows.map((r) => ({
    transferId: String(r.transfer_id),
    batchNumber: r.batch_number,
    fromMachine: r.source_machine_code,
    toMachine: r.destination_machine_code,
    subProcess: r.sub_process,
    reason: r.reason ?? undefined,
    assignedBy: r.assigned_by_name ?? 'Unknown',
    transferredAt: r.transferred_at.toISOString(),
    transferType: r.transfer_type ?? 'SINGLE',
  }));
}

export async function loadRecentOrderMachineTransfers(
  planDate: Date,
  shiftCode: string,
  limit = 50,
): Promise<OrderMachineTransferRow[]> {
  const result = await sql<{
    transfer_id: string;
    batch_number: string;
    source_machine_code: string;
    destination_machine_code: string;
    sub_process: string;
    reason: string | null;
    transferred_at: Date;
    assigned_by_name: string | null;
    transfer_type: string;
  }>`
    SELECT t.transfer_id, t.batch_number, t.source_machine_code, t.destination_machine_code,
           t.sub_process, t.reason, t.transferred_at, t.transfer_type,
           u.full_name AS assigned_by_name
    FROM txn.order_machine_transfer t
    LEFT JOIN security.app_user u ON u.user_id = t.assigned_by
    WHERE EXISTS (
      SELECT 1 FROM planning.ppc_batch pb
      WHERE pb.batch_number = t.batch_number
        AND pb.plan_date = ${planDate}
        AND pb.shift_code = ${shiftCode}
    )
    ORDER BY t.transferred_at DESC
    LIMIT ${limit}
  `.execute(db);

  return mapTransferRows(result.rows);
}

export async function loadRecentOrderMachineTransfersGlobal(
  limit = 50,
): Promise<OrderMachineTransferRow[]> {
  const result = await sql<{
    transfer_id: string;
    batch_number: string;
    source_machine_code: string;
    destination_machine_code: string;
    sub_process: string;
    reason: string | null;
    transferred_at: Date;
    assigned_by_name: string | null;
    transfer_type: string;
  }>`
    SELECT t.transfer_id, t.batch_number, t.source_machine_code, t.destination_machine_code,
           t.sub_process, t.reason, t.transferred_at, t.transfer_type,
           u.full_name AS assigned_by_name
    FROM txn.order_machine_transfer t
    LEFT JOIN security.app_user u ON u.user_id = t.assigned_by
    ORDER BY t.transferred_at DESC
    LIMIT ${limit}
  `.execute(db);

  return mapTransferRows(result.rows);
}
