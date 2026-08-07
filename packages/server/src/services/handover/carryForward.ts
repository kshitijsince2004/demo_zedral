/**
 * Shared open-work re-parent used by manual acceptHandover and Tier-1 auto boundary.
 */
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db-types';

type Trx = Transaction<DB> | Kysely<DB>;

type ProdCarryTable =
  | 'txn.prod_hrs'
  | 'txn.prod_pkl'
  | 'txn.ann_charge'
  | 'txn.prod_rwd'
  | 'txn.prod_crs'
  | 'txn.prod_ctl';

/** Process IDs that reparent rows in txn.prod_* / txn.ann_charge (non-CRM). */
export const PROD_CARRY_PROCESS_IDS: Readonly<Record<number, ProdCarryTable>> = {
  1: 'txn.prod_hrs',
  2: 'txn.prod_pkl',
  4: 'txn.ann_charge',
  6: 'txn.prod_rwd',
  7: 'txn.prod_crs',
  8: 'txn.prod_ctl',
};

async function reparentProdOpenWork(
  trx: Trx,
  table: ProdCarryTable,
  outgoingShiftLogId: string,
  incomingShiftLogId: string,
): Promise<void> {
  switch (table) {
    case 'txn.prod_hrs':
    case 'txn.prod_pkl':
      await trx
        .updateTable(table)
        .set({ shift_log_id: incomingShiftLogId })
        .where('shift_log_id', '=', outgoingShiftLogId)
        .where('status', '=', 'IN_PROGRESS')
        .execute();
      break;
    case 'txn.ann_charge':
      await trx
        .updateTable('txn.ann_charge')
        .set({ shift_log_id: incomingShiftLogId })
        .where('shift_log_id', '=', outgoingShiftLogId)
        .where('status', '=', 'IN_PROCESS')
        .execute();
      break;
    case 'txn.prod_rwd':
    case 'txn.prod_ctl':
      await trx
        .updateTable(table)
        .set({ shift_log_id: incomingShiftLogId })
        .where('shift_log_id', '=', outgoingShiftLogId)
        .where('time_to', 'is', null)
        .execute();
      break;
    case 'txn.prod_crs':
      await trx
        .updateTable('txn.prod_crs')
        .set({ shift_log_id: incomingShiftLogId })
        .where('shift_log_id', '=', outgoingShiftLogId)
        .where('output_wt_mt', 'is', null)
        .execute();
      break;
  }
}

async function reparentSkpOpenWork(
  trx: Trx,
  args: {
    outgoingShiftLogId: string;
    incomingShiftLogId: string;
    incomingShiftCode: string;
    incomingProdDate: string;
    updatedAt: Date;
  },
): Promise<void> {
  const { outgoingShiftLogId, incomingShiftLogId, incomingShiftCode, incomingProdDate, updatedAt } =
    args;
  await trx
    .updateTable('txn.crm_order')
    .set({
      shift_log_id: incomingShiftLogId,
      shift_code: incomingShiftCode,
      prod_date: incomingProdDate,
      production_day: incomingProdDate,
      updated_at: updatedAt,
    })
    .where('shift_log_id', '=', outgoingShiftLogId)
    .where('sub_process', '=', 'SKINPASS')
    .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
    .execute();
}

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
    .set({ shift_log_id: incomingShiftLogId })
    .where('shift_log_id', '=', outgoingShiftLogId)
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
        shift_log_id: incomingShiftLogId,
        shift_code: incomingShiftCode,
        prod_date: incomingProdDate,
        production_day: incomingProdDate,
        updated_at: updatedAt,
      })
      .where('shift_log_id', '=', outgoingShiftLogId)
      .where('status', 'in', ['IN_PROGRESS', 'STOPPAGE'])
      .execute();
  }

  if (processId === 5) {
    await reparentSkpOpenWork(trx, {
      outgoingShiftLogId,
      incomingShiftLogId,
      incomingShiftCode,
      incomingProdDate,
      updatedAt,
    });
    return;
  }

  if (processId != null) {
    const table = PROD_CARRY_PROCESS_IDS[processId];
    if (table) {
      await reparentProdOpenWork(trx, table, outgoingShiftLogId, incomingShiftLogId);
    }
  }
}
