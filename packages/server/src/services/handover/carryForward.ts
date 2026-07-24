/**
 * Shared open-work re-parent used by manual acceptHandover and Tier-1 auto boundary.
 */
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db-types';

type Trx = Transaction<DB> | Kysely<DB>;

export async function reparentOpenWork(
  trx: Trx,
  args: {
    machineCode: string;
    processId: number | null;
    outgoingShiftLogId: string;
    incomingShiftLogId: string;
    incomingShiftCode: string;
    incomingProdDate: string; // YYYY-MM-DD
    updatedAt?: Date;
  },
): Promise<void> {
  const {
    processId,
    outgoingShiftLogId,
    incomingShiftLogId,
    incomingShiftCode,
    incomingProdDate,
    updatedAt = new Date(),
  } = args;

  await trx
    .updateTable('txn.stoppage')
    .set({ shift_log_id: incomingShiftLogId as any })
    .where('shift_log_id', '=', outgoingShiftLogId as any)
    .where('end_at', 'is', null)
    .execute();

  const rollingProcess = await trx
    .selectFrom('master.process')
    .select('process_id')
    .where('code', 'in', ['ROLLING', 'CRM'])
    .execute();
  const rollingIds = new Set(rollingProcess.map((p) => Number(p.process_id)));
  if (processId != null && rollingIds.has(processId)) {
    await trx
      .updateTable('txn.crm_order')
      .set({
        shift_log_id: incomingShiftLogId as any,
        shift_code: incomingShiftCode,
        prod_date: incomingProdDate as any,
        production_day: incomingProdDate as any,
        updated_at: updatedAt,
      } as any)
      .where('shift_log_id', '=', outgoingShiftLogId as any)
      .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .execute();
  }

  const entryTableByProcess: Record<number, string> = {
    2: 'txn.prod_pkl_entry',
    4: 'txn.prod_ann_entry',
    5: 'txn.prod_skp_entry',
    6: 'txn.prod_rwd_entry',
    7: 'txn.prod_crs_entry',
    8: 'txn.prod_ctl_entry',
  };
  const table = processId != null ? entryTableByProcess[processId] : undefined;
  if (table) {
    await trx
      .updateTable(table as any)
      .set({ shift_log_id: incomingShiftLogId as any })
      .where('shift_log_id', '=', outgoingShiftLogId as any)
      .where('status', '=', 'IN_PROGRESS')
      .execute();
  }
}
