import { OrderSourceStrategy, ActiveOrderSnapshot, OrderDetailResult, QueueSnapshotResult, ShiftProductionSummary } from './OrderSource';
import { ShiftLogService } from '../shiftLogService';
import { parsePlantDateOnly } from '@m1/shared-validation';
import { db } from '../../db';

export class LegacyOrderSource implements OrderSourceStrategy {
  async findActiveOrder(_machineCode: string): Promise<ActiveOrderSnapshot | null> {
    // Legacy lines don't have a single strict "active order" in the same way 6HI does for handovers.
    return null;
  }

  async getOrderDetail(_machineCode: string, _userId: number): Promise<OrderDetailResult> {
    throw new Error('Legacy lines do not support getOrderDetail currently.');
  }

  async getQueueSnapshot(_shiftDate: string, _shiftCode: string, _machineCode: string): Promise<QueueSnapshotResult> {
    return {
      rolling: [],
      skinpass: [],
      pendingAllocation: [],
      backlogRolling: [],
      backlogSkinpass: [],
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
