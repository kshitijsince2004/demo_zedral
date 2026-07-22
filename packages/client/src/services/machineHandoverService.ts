import { apiClient } from '../lib/apiClient';
import { postQueued } from '../lib/sync/queuedApi';

export interface PendingHandover {
  handover_id: string;
  machine_code: string;
  batch_number: string | null;
  machine_status: string;
  handover_priority: string;
  remarks: string;
  queue_snapshot: {
    rolling?: QueueItem[];
    skinpass?: QueueItem[];
    pendingAllocation?: QueueItem[];
    backlogRolling?: QueueItem[];
    backlogSkinpass?: QueueItem[];
  };
  production_snapshot: HandoverProductionSnapshot;
  open_stoppages: OpenStoppage[];
  outgoing_shift_code: string;
  incoming_shift_code: string;
  outgoing_prod_date: string;
  created_at: string;
  clarification_notes?: string | null;
}

export function resolveHandoverQueueSnapshot(handover: PendingHandover) {
  const direct = handover.queue_snapshot;
  const fromSnapshot = (handover.production_snapshot as HandoverProductionSnapshot & {
    queueSnapshot?: PendingHandover['queue_snapshot'];
  })?.queueSnapshot;

  if (
    direct
    && (
      direct.rolling?.length
      || direct.skinpass?.length
      || direct.pendingAllocation?.length
      || direct.backlogRolling?.length
      || direct.backlogSkinpass?.length
    )
  ) {
    return direct;
  }
  return fromSnapshot ?? direct ?? { rolling: [], skinpass: [], pendingAllocation: [] };
}

export interface QueueItem {
  batchNumber: string;
  status: string;
  customer?: string;
  weightMt?: number;
  subProcess?: string;
  queueSeq?: number;
  motherCoil?: string;
}

export interface OpenStoppage {
  stoppageId?: string;
  startAt?: string;
  reason?: string;
  category?: string;
  status?: string;
}

export interface ActiveOrderDetail {
  batchNumber: string;
  customer?: string;
  grade?: string;
  subProcess: string;
  status: string;
  startTime?: string;
  runtimeMinutes?: number;
  progressPct?: number;
  producedWeightMt?: number;
  remainingWeightMt?: number;
  targetWeightMt?: number;
  destinationProcess?: string;
  currentPassNo?: number;
  targetThkMm?: number;
}

export interface HandoverProductionSnapshot {
  batchNumber?: string;
  status?: string;
  subProcess?: string;
  orderSnapshot?: OrderSnapshot | null;
  machineCondition?: string;
  machineConditionRemarks?: string | null;
  crewNotes?: string | null;
  selectedCrewMembers?: Array<{ id: string; memberName: string; roleLabel: string }>;
  shiftManualFields?: {
    scrapKg?: number | null;
    coolantTempDegC?: number | null;
    coolantPressKgCm2?: number | null;
    shiftRemarks?: string | null;
  };
  shiftProductionSummary?: ShiftProductionSummary | null;
  utilizationMetrics?: UtilizationMetrics | null;
  activeOrderDetail?: ActiveOrderDetail | null;
  queueSnapshot?: {
    rolling?: QueueItem[];
    skinpass?: QueueItem[];
    pendingAllocation?: QueueItem[];
    backlogRolling?: QueueItem[];
    backlogSkinpass?: QueueItem[];
  };
}

export interface OrderSnapshot {
  currentStage?: string;
  currentPassNumber?: number;
  currentThicknessMm?: number;
  targetThicknessMm?: number;
  nextActionRequired?: string;
  orderRemarks?: string;
}

export interface ShiftProductionSummary {
  totalProdMt: number;
  totalRollingMt: number;
  totalSkinpassMt: number;
  totalRerollMt: number;
  completedOrderCount: number;
  inProgressOrderCount: number;
  totalStoppageMinutes: number;
  totalBreakdownMinutes: number;
  machineUtilizationPct: number;
}

export interface UtilizationMetrics {
  runningPct: number;
  stopPagePct: number;
  idlePct: number;
  runningMin: number;
  stoppageMin: number;
  stoppageCount: number;
}

export interface CrewMember {
  id: string;
  operatorId: string;
  empCode: string;
  operatorName: string;
  roleCode: string;
}

export interface HandoverPreview {
  machineCode: string;
  machineName: string;
  processCode: string;
  machineStatus: string;
  runtimeMinutes: number | null;
  processLabel: string;
  activeOrder: { batchNumber: string; status: string; subProcess: string } | null;
  activeOrderDetail: ActiveOrderDetail | null;
  productionSnapshot: Record<string, unknown>;
  openStoppages: OpenStoppage[];
  queueSnapshot: {
    rolling: QueueItem[];
    skinpass: QueueItem[];
    pendingAllocation: QueueItem[];
    backlogRolling?: QueueItem[];
    backlogSkinpass?: QueueItem[];
  };
  nextShift: { shiftCode: string; prodDate: string };
  shift: {
    shiftCode: string;
    shiftName: string;
    prodDate: string;
    shiftLogId?: string | number | null;
    windowStart?: string;
    windowEnd?: string;
    actualSessionStartAt?: string | null;
  };
  shiftProductionSummary: ShiftProductionSummary | null;
  crewSnapshot: CrewMember[];
  machineCrewRoster?: Array<{ id: string; memberName: string; roleLabel: string }>;
  utilizationMetrics: UtilizationMetrics | null;
}

export interface HandoverSubmitPayload {
  machineStatus: string;
  machineCondition?: string;
  machineConditionRemarks?: string;
  remarks: string;
  handoverPriority?: string;
  breakdownCode?: string;
  breakdownDescription?: string;
  downtimeMinutes?: number;
  maintenanceStatus?: string;
  scrapKg?: number;
  coolantTempDegC?: number;
  coolantPressKgCm2?: number;
  shiftRemarks?: string;
  orderSnapshot?: OrderSnapshot;
  crewNotes?: string;
  selectedCrewIds?: string[];
}

export interface HandoverOverviewRow {
  handoverId: string;
  machineCode: string;
  batchNumber: string | null;
  machineStatus: string;
  status: string;
  /** Production date of the outgoing shift (YYYY-MM-DD). */
  prodDate?: string;
  handoverPriority?: string;
  remarks?: string;
  outgoingShiftCode: string;
  incomingShiftCode: string;
  createdAt: string;
  acceptedAt?: string;
  shiftStartAt?: string;
  shiftEndAt?: string;
  shiftDurationMinutes?: number;
  shiftDurationLabel?: string;
  /** Display name (full_name preferred, else username). */
  outgoingUsername?: string;
  incomingUsername?: string;
  createdByBoundary?: boolean;
  subProcess?: string;
  motherCoil?: string;
  coilNo?: string;
  slitId?: string;
}

export interface HandoverOverview {
  pending: HandoverOverviewRow[];
  recent: HandoverOverviewRow[];
  awaitingAcceptance: number;
}

export const machineHandoverService = {
  getOverview: () => apiClient.get<HandoverOverview>('/machines/handover/overview'),

  listPending: () =>
    apiClient.get<{ pending: PendingHandover[] }>('/machines/handover/pending'),

  getPending: (machineCode: string) =>
    apiClient.get<{ pending: PendingHandover | null }>(
      `/machines/handover/${encodeURIComponent(machineCode)}/pending`,
    ),

  getDraft: (machineCode: string) =>
    apiClient.get<{ draft: PendingHandover | null }>(
      `/machines/handover/${encodeURIComponent(machineCode)}/draft`,
    ),

  getPreview: (machineCode: string) =>
    apiClient.get<HandoverPreview>(
      `/machines/handover/${encodeURIComponent(machineCode)}/preview`,
    ),

  ensureSession: async (machineCode: string) => {
    const result = await postQueued<{ session: unknown; pendingHandover: PendingHandover | null }>(
      `/machines/handover/${encodeURIComponent(machineCode)}/session`,
      {},
      `handover:${machineCode}`,
    );
    return result.data ?? { session: null, pendingHandover: null };
  },

  saveDraft: async (machineCode: string, payload: Partial<HandoverSubmitPayload>) => {
    const result = await postQueued<PendingHandover>(
      `/machines/handover/${encodeURIComponent(machineCode)}/draft`,
      payload,
      `handover:${machineCode}`,
    );
    return result.data ?? ({ ...payload, machine_code: machineCode } as PendingHandover);
  },

  submitOutgoing: async (machineCode: string, payload: HandoverSubmitPayload) => {
    const result = await postQueued<PendingHandover>(
      `/machines/handover/${encodeURIComponent(machineCode)}/outgoing`,
      payload,
      `handover:${machineCode}`,
    );
    return result.data ?? ({ ...payload, machine_code: machineCode } as PendingHandover);
  },

  accept: async (handoverId: string) => {
    await postQueued(`/machines/handover/accept/${encodeURIComponent(handoverId)}`, {}, `handover:${handoverId}`);
  },

  requestClarification: async (handoverId: string, notes: string) => {
    await postQueued(
      `/machines/handover/clarification/${encodeURIComponent(handoverId)}`,
      { notes },
      `handover:${handoverId}`,
    );
  },
};
