import { sql } from 'kysely';
import { OrderSourceStrategy, ActiveOrderSnapshot, OrderDetailResult, QueueSnapshotResult, ShiftProductionSummary } from './OrderSource';
import { ShiftLogService } from '../shiftLogService';
import { parsePlantDateOnly, currentPlantDate, postgresDateOnly } from '@m1/shared-validation';
import { db } from '../../db';

/**
 * Legacy lines (HRS/PKL/CRS/CTL/RWD) capture production in txn.prod_* tables.
 * Planning backlog for handover still reads planning.ppc_batch + txn.crm_order —
 * the same plant-level definition as Plant Head KPI/drawer (calendar plan_date,
 * incomplete status, active machine). Batches only appear when those machines
 * have ppc_batch rows; prod_* entries without a PPC batch are out of scope here.
 */
export class LegacyOrderSource implements OrderSourceStrategy {
  async findActiveOrder(_machineCode: string): Promise<ActiveOrderSnapshot | null> {
    // Legacy lines don't have a single strict "active order" in the same way 6HI does for handovers.
    return null;
  }

  async getOrderDetail(_machineCode: string, _userId: number): Promise<OrderDetailResult> {
    throw new Error('Legacy lines do not support getOrderDetail currently.');
  }

  async getQueueSnapshot(shiftDate: string, _shiftCode: string, machineCode: string): Promise<QueueSnapshotResult> {
    const viewDate = postgresDateOnly(shiftDate || currentPlantDate());
    const rows = await db
      .selectFrom('planning.ppc_batch as pb')
      .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
      .leftJoin('master.machine as m', 'm.machine_code', 'pb.machine_code')
      .select([
        'pb.batch_number',
        'pb.coil_no',
        'pb.customer_name',
        'pb.ppc_weight_mt',
        'pb.sub_process',
        'pb.queue_seq',
        'o.status as order_status',
      ])
      .where('pb.machine_code', '=', machineCode)
      .where(sql`pb.plan_date`, '<', sql`${viewDate}::date`)
      .where((eb) =>
        eb.or([
          eb('o.status', 'is', null),
          eb('o.status', 'not in', ['COMPLETED', 'REJECTED']),
        ]),
      )
      .where((eb) =>
        eb.or([
          eb('m.machine_status', 'is', null),
          eb('m.machine_status', '!=', 'OFFLINE'),
        ]),
      )
      .orderBy('pb.plan_date', 'asc')
      .orderBy('pb.batch_number', 'asc')
      .execute();

    const backlogRolling: unknown[] = [];
    const backlogSkinpass: unknown[] = [];
    let seq = 0;
    for (const row of rows) {
      seq += 1;
      const card = {
        batchNumber: row.batch_number,
        status: row.order_status ?? 'PENDING',
        customer: row.customer_name ?? undefined,
        weightMt: Number(row.ppc_weight_mt ?? 0),
        subProcess: row.sub_process ?? undefined,
        queueSeq: row.queue_seq ?? seq,
        motherCoil: row.coil_no ?? undefined,
        isBacklog: true,
      };
      if (String(row.sub_process ?? '').toUpperCase() === 'SKIN_PASS') {
        backlogSkinpass.push(card);
      } else {
        // ROLLING and any non-CRM sub_process → rolling bucket for handover flatten.
        backlogRolling.push(card);
      }
    }

    return {
      rolling: [],
      skinpass: [],
      pendingAllocation: [],
      backlogRolling,
      backlogSkinpass,
    };
  }

  async getShiftSummary(_shiftLogId: string, _machineCode: string): Promise<ShiftProductionSummary | null> {
    // Model A doesn't compute shift summaries on the fly here yet.
    return null;
  }

  async saveShiftSummary(_shiftLogId: string, _input: any, _userId: number): Promise<void> {
    // Model A saves these fields directly via shiftLogRoutes manually if at all.
  }

  async resolveShiftLogIdForPlan(prodDate: Date | string, shiftCode: string, _machineCode: string, processId: number | null): Promise<string | null> {
    if (!processId) return null;
    const planDate = parsePlantDateOnly(prodDate);
    const slRow = await db
      .selectFrom('txn.shift_log')
      .select('shift_log_id')
      .where('process_id', '=', processId)
      .where('shift_code', '=', shiftCode)
      .where('prod_date', '=', planDate)
      .orderBy('shift_log_id', 'desc')
      .executeTakeFirst();
    return slRow ? String(slRow.shift_log_id) : null;
  }

  async ensureActiveShiftLog(userId: number, prodDate: Date | string, shiftCode: string, _machineCode: string, processId: number | null): Promise<string> {
    if (!processId) {
      throw new Error('Process ID is required to resolve legacy shift log');
    }
    const shiftLogId = await ShiftLogService.create({
      processId,
      productionDate: parsePlantDateOnly(prodDate),
      shiftCode,
      supervisorId: userId
    });
    return String(shiftLogId);
  }
}
