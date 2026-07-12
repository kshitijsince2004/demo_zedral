import { OrderSourceStrategy, ActiveOrderSnapshot, OrderDetailResult, QueueSnapshotResult, ShiftProductionSummary } from './OrderSource';
import { SixHiExecutionService, SixHiQueueService, SixHiShiftService } from '../sixHi';
import { parsePlantDateOnly, formatPlantDate } from '@m1/shared-validation';

export class SixHiOrderSource implements OrderSourceStrategy {
  async findActiveOrder(machineCode: string): Promise<ActiveOrderSnapshot | null> {
    const active = await SixHiExecutionService.findActiveMachineOrder(machineCode);
    if (!active) return null;
    return active;
  }

  async getOrderDetail(machineCode: string, userId: number): Promise<OrderDetailResult> {
    const activeRow = await SixHiExecutionService.findActiveMachineOrder(machineCode);
    if (!activeRow) throw new Error('No active order');
    
    const order = await SixHiExecutionService.getOrder(activeRow.batchNumber, userId);

    const prodStartAt = order.prodStartAt;
    const actualWt = order.rolling?.actualWeightMt ?? order.skinPass?.actualWeightMt ?? 0;
    const targetWt = order.ppcWeightMt ?? 0;
    const progressPct = targetWt > 0
      ? Math.min(100, Math.round((actualWt / targetWt) * 100))
      : 0;
    const remainingMt = Math.max(0, targetWt - actualWt);

    const activeOrderDetail = {
      batchNumber: activeRow.batchNumber,
      customer: order.customer,
      grade: order.grade,
      subProcess: activeRow.subProcess,
      status: activeRow.status,
      startTime: prodStartAt ?? null,
      runtimeMinutes: order.prodDurationMin ?? null,
      progressPct,
      producedWeightMt: actualWt,
      remainingWeightMt: remainingMt,
      targetWeightMt: targetWt,
      destinationProcess: order.ppcDestination ?? null,
      currentPassNo: order.rolling?.totalPasses ?? null,
      targetThkMm: order.targetThkMm ?? null,
    };

    const productionSnapshot = {
      batchNumber: activeRow.batchNumber,
      status: activeRow.status,
      subProcess: activeRow.subProcess,
      rolling: order.rolling,
      skinPass: order.skinPass,
    };

    const openStoppages = (order.stoppages ?? []).filter((s) => !s.endAt);
    const runtimeMinutes = order.prodDurationMin ?? null;
    const processLabel = activeRow?.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Rolling';

    return {
      activeOrderDetail,
      productionSnapshot,
      openStoppages,
      runtimeMinutes,
      processLabel,
    };
  }

  async getQueueSnapshot(shiftDate: string, shiftCode: string, machineCode: string): Promise<QueueSnapshotResult> {
    const rollingQueue = await SixHiQueueService.getQueue('ROLLING', shiftDate, shiftCode, machineCode);
    const skinQueue = await SixHiQueueService.getQueue('SKIN_PASS', shiftDate, shiftCode, machineCode);

    return {
      rolling: rollingQueue.queue,
      skinpass: skinQueue.queue,
      pendingAllocation: this.mergeQueueCards(
        rollingQueue.pendingAllocation as any,
        skinQueue.pendingAllocation as any,
      ),
      backlogRolling: rollingQueue.backlog,
      backlogSkinpass: skinQueue.backlog,
    };
  }
  
  private mergeQueueCards(...groups: any[][]): any[] {
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const group of groups) {
      for (const card of group) {
        if (seen.has(card.batchNumber)) continue;
        seen.add(card.batchNumber);
        merged.push(card);
      }
    }
    return merged;
  }

  async getShiftSummary(shiftLogId: string, machineCode: string): Promise<ShiftProductionSummary | null> {
    const summary = await SixHiShiftService.getShiftSummary(shiftLogId, machineCode);
    return {
      totalProdMt: summary.totalProdMt,
      totalRollingMt: summary.totalRollingMt,
      totalSkinpassMt: summary.totalSkinpassMt,
      totalRerollMt: summary.totalRerollMt,
      completedOrderCount: summary.completedOrders?.length ?? 0,
      inProgressOrderCount: summary.ordersInProgress?.length ?? 0,
      totalStoppageMinutes: summary.totalStoppageMinutes ?? 0,
      totalBreakdownMinutes: summary.totalBreakdownMinutes ?? 0,
      machineUtilizationPct: summary.machineUtilizationPct ?? 0,
      coolantTempDegC: summary.coolantTempDegC,
      coolantPressKgCm2: summary.coolantPressKgCm2,
      scrapKg: summary.scrapKg,
    };
  }

  async saveShiftSummary(shiftLogId: string, input: any, userId: number): Promise<void> {
    await SixHiShiftService.saveShiftSummary(
      shiftLogId,
      input.scrapKg,
      input.coolantTempDegC,
      input.coolantPressKgCm2,
      userId,
    );
  }

  async resolveShiftLogIdForPlan(prodDate: Date | string, shiftCode: string, _machineCode: string, _processId: number | null): Promise<string | null> {
    return SixHiShiftService.resolveShiftLogIdForPlan(formatPlantDate(prodDate as string), shiftCode);
  }

  async ensureActiveShiftLog(userId: number, prodDate: Date | string, shiftCode: string, _machineCode: string, _processId: number | null): Promise<string> {
    return SixHiShiftService.ensureActiveShiftLog(
      userId,
      parsePlantDateOnly(formatPlantDate(prodDate as string)),
      shiftCode
    );
  }
}
