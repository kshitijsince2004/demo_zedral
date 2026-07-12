export interface ActiveOrderSnapshot {
  batchNumber: string;
  status: string;
  subProcess: string;
  [key: string]: any;
}

export interface ActiveOrderDetail {
  batchNumber: string;
  customer?: string | null;
  grade?: string | null;
  subProcess?: string | null;
  status?: string | null;
  startTime: string | null;
  runtimeMinutes: number | null;
  progressPct: number;
  producedWeightMt: number;
  remainingWeightMt: number;
  targetWeightMt: number;
  destinationProcess?: string | null;
  currentPassNo?: number | null;
  targetThkMm?: number | null;
}

export interface OrderDetailResult {
  activeOrderDetail: ActiveOrderDetail | null;
  productionSnapshot: Record<string, unknown>;
  openStoppages: unknown[];
  runtimeMinutes: number | null;
  processLabel: string;
}

export interface QueueSnapshotResult {
  rolling: unknown[];
  skinpass: unknown[];
  pendingAllocation: unknown[];
  backlogRolling: unknown[];
  backlogSkinpass: unknown[];
}

export interface ShiftProductionSummary {
  totalProdMt?: number;
  totalRollingMt?: number;
  totalSkinpassMt?: number;
  totalRerollMt?: number;
  completedOrderCount?: number;
  inProgressOrderCount?: number;
  totalStoppageMinutes?: number;
  totalBreakdownMinutes?: number;
  machineUtilizationPct?: number;
  coolantTempDegC?: number;
  coolantPressKgCm2?: number;
  scrapKg?: number;
}

export interface OrderSourceStrategy {
  findActiveOrder(machineCode: string): Promise<ActiveOrderSnapshot | null>;
  getOrderDetail(machineCode: string, userId: number): Promise<OrderDetailResult>;
  getQueueSnapshot(shiftDate: string, shiftCode: string, machineCode: string): Promise<QueueSnapshotResult>;
  getShiftSummary(shiftLogId: string, machineCode: string): Promise<ShiftProductionSummary | null>;
  saveShiftSummary(shiftLogId: string, input: any, userId: number): Promise<void>;
  resolveShiftLogIdForPlan(prodDate: Date | string, shiftCode: string, machineCode: string, processId: number | null): Promise<string | null>;
  ensureActiveShiftLog(userId: number, prodDate: Date | string, shiftCode: string, machineCode: string, processId: number | null): Promise<string>;
}

export function getOrderSourceStrategy(machineCode: string): OrderSourceStrategy {
  const { parseCrmMillCode } = require('../../utils/machineAllocation');
  const { SixHiOrderSource } = require('./SixHiOrderSource');
  const { LegacyOrderSource } = require('./LegacyOrderSource');

  if (parseCrmMillCode(machineCode)) {
    return new SixHiOrderSource();
  }
  return new LegacyOrderSource();
}
