import type { OrderRejectionInfo, SixHiDestination, SixHiOrderStatus, SixHiSubProcess } from './sixHi';
import type { OrderJourneyView } from './processRoute';

export type LiveOrderStatus = SixHiOrderStatus | 'PREPARING';

export type MachineLiveStatus =
  | 'RUNNING'
  | 'IDLE'
  | 'STOPPAGE'
  | 'BREAKDOWN'
  | 'MAINTENANCE'
  | 'OFFLINE';

// ---------------------------------------------------------------------------
// Machine State Event
// Represents a persisted machine state transition (from txn.machine_state_event)
// ---------------------------------------------------------------------------
export type MachineStateEventType =
  | 'RUNNING_STARTED'
  | 'RUNNING_ENDED'
  | 'STOPPAGE_STARTED'
  | 'STOPPAGE_ENDED'
  | 'IDLE_STARTED'
  | 'IDLE_ENDED'
  | 'MAINTENANCE_STARTED'
  | 'MAINTENANCE_ENDED'
  | 'DEFECT_REPORTED'
  | 'DEFECT_CLOSED'
  | 'ORDER_REJECTED'
  | 'ORDER_REINSTATED';

export interface MachineStateEvent {
  eventId: string;
  machineCode: string;
  eventType: MachineStateEventType;
  occurredAt: string;        // ISO timestamp
  endedAt?: string;          // ISO timestamp, undefined = still active
  durationMin?: number;
  batchNumber?: string;
  operatorId?: number;
  reason?: string;
  categoryCode?: string;
  shiftCode?: string;
}

// ---------------------------------------------------------------------------
// Machine Utilization Summary (24h window)
// ---------------------------------------------------------------------------
export interface MachineUtilizationSummary {
  machineCode: string;
  windowHours: number;
  runningMin: number;
  idleMin: number;
  stoppageMin: number;
  maintenanceMin: number;
  runningPct: number;
  idlePct: number;
  stopPagePct: number;
  maintenancePct: number;
  orderCount: number;
  stoppageCount: number;
  topStoppageReasons: { reason: string; count: number; totalMin: number }[];
}

// ---------------------------------------------------------------------------
// Machine Command Center — full data payload for machine detail page
// ---------------------------------------------------------------------------
export interface MachineCommandCenterData {
  machineCode: string;
  machineName: string;
  currentStatus: MachineLiveStatus;
  currentOperator?: string;
  shiftCode?: string;
  currentOrder?: {
    batchNumber: string;
    customer: string;
    grade: string;
    subProcess: string;
    weightMt: number;
    runningSinceAt?: string;    // ISO timestamp
    runtimeMin?: number;
    actualWeightMt?: number;
    targetThkMm: number;
    inputThkMm?: number;
  };
  activeStoppage?: {
    stoppageId: string;
    reason: string;
    categoryCode: string;
    startAt: string;            // ISO timestamp
    operatorName?: string;
    remarks?: string;
  };
  idleHistory: MachineStateEvent[];
  stoppageHistory: MachineStateEvent[];
  timeline: MachineStateEvent[];
  utilization: MachineUtilizationSummary;
  nextOrder?: {
    batchNumber: string;
    customer: string;
    queuePosition: number;
    weightMt: number;
    subProcess?: string;
  };
  orderQueue?: Array<{
    batchNumber: string;
    customer: string;
    status: string;
    weightMt: number;
    subProcess?: string;
  }>;
  completedOrders?: Array<{
    batchNumber: string;
    customer: string;
    completedAt: string;
    weightMt: number;
    subProcess?: string;
  }>;
  /** Multiple in-progress orders on one machine (combined run). */
  activeOrderCount?: number;
  activeOrders?: Array<{
    batchNumber: string;
    coilNo?: string;
    customer: string;
    grade: string;
    subProcess: string;
    status: string;
    weightMt: number;
    targetThkMm: number;
    inputThkMm?: number;
    runtimeMin?: number;
    actualWeightMt?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Enhanced MachineStatusCard (adds live state timestamps for smart tiles)
// ---------------------------------------------------------------------------
export interface LiveKpis {
  runningMachines: number;
  idleMachines: number;
  breakdownMachines: number;
  activeOrders: number;
  /** Sum of PPC weight for orders in the current shift queue (not completed output). */
  queuedProductionMt: number;
  currentStoppages: number;
  /** Share of scoped machines currently in RUNNING state (machine count, not runtime). */
  machinesRunningPct: number;
  /** Actual production vs shift target from ProductionMetricsService. */
  shiftPerformancePct: number;
  /** Current shift context (operator capture source of truth). */
  prodDate: string;
  shiftCode: string;
  shiftLogId?: string | null;
  shiftTargetMt: number;
  shiftProductionMt: number;
  shiftCompletedProdMt: number;
  shiftInProgressProdMt: number;
  shiftRollingMt: number;
  shiftSkinpassMt: number;
  /** Live plant-wide production for prodDate (all CRM shifts that day). */
  productionTodayMt: number;
}

/** Runtime utilization from machine state events: running minutes ÷ window minutes. */
export interface MachineRuntimeUtilizationRow {
  machineCode: string;
  machineName: string;
  runtimeUtilizationPct: number;
  windowHours: number;
}

export interface LiveOrderRow {
  batchNumber: string;
  customer: string;
  grade: string;
  machineCode: string;
  machineName: string;
  currentProcess: string;
  operatorName?: string;
  runtimeMin?: number;
  status: LiveOrderStatus;
  weightMt: number;
  destination?: SixHiDestination;
  subProcess?: SixHiSubProcess;
  coilNo: string;
  /** Mother coil ID — same as coilNo when sourced from CRM/PPC. */
  motherCoil?: string;
  slitId?: string;
  shiftCode?: string;
  nextProcess?: string;
  completionPct?: number;
}

export interface MachineStatusCard {
  machineCode: string;
  machineName: string;
  status: MachineLiveStatus;
  currentOrder?: string;
  currentCoil?: string;
  currentOperator?: string;
  /** ISO timestamp when current state began (runningSinceAt, idleSinceAt, or stoppageSinceAt) */
  stateSinceAt?: string;
  /** For STOPPAGE state: the reason/category label */
  activeStoppageReason?: string;
  /** Operator-entered remarks (stoppage, machine state, or latest order remark) */
  operatorRemarks?: string;
  /** Last completed order (for IDLE card) */
  lastOrderBatchNumber?: string;
  /** Last operator who ran an order (for IDLE card) */
  lastOperatorName?: string;
  runtimeMin?: number;
  productionWeightMt?: number;
  shiftProgressPct?: number;
  rejectedCount?: number;
  rejectedWeightMt?: number;
  lastUpdateAt?: string;
  processCode?: string;
  shiftCode?: string;
  /** When multiple orders run together on one machine (combined run). */
  activeOrderCount?: number;
  activeOrders?: Array<{
    batchNumber: string;
    coilNo?: string;
    motherCoil?: string;
    slitId?: string;
    status: string;
    customer?: string;
    weightMt?: number;
  }>;
}

export interface MachineHeadStoppageRow {
  batchNumber: string;
  machineCode: string;
  category: string;
  /** Closed: recorded minutes. Open: live-elapsed minutes since start. */
  durationMin?: number;
  startAt: string;
  /** Null while the stoppage is still open (Active). */
  endAt?: string;
  /** ACTIVE = still open, ENDED = closed. */
  status: 'ACTIVE' | 'ENDED';
  subProcess?: string;
  remarks?: string;
  motherCoil?: string;
  coilNo?: string;
  slitId?: string;
}

export interface MachineHeadOperatorRow {
  operatorName: string;
  batchNumber: string;
  machineCode: string;
  status: string;
  subProcess?: string;
  motherCoil?: string;
  coilNo?: string;
  slitId?: string;
}

export interface MachineHeadProductionRow {
  batchNumber: string;
  machineCode: string;
  completedAt: string;
  weightMt: number;
  subProcess?: string;
  motherCoil?: string;
  coilNo?: string;
  slitId?: string;
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
  /** Outgoing operator remarks (handover notes). */
  remarks?: string;
  outgoingShiftCode: string;
  incomingShiftCode: string;
  createdAt: string;
  acceptedAt?: string;
  /** Actual operator session / handover start from machine_shift_session. */
  shiftStartAt?: string;
  /** Actual handover completion time (accepted_at). */
  shiftEndAt?: string;
  shiftDurationMinutes?: number;
  shiftDurationLabel?: string;
  /** Display name (full_name preferred, else username). */
  outgoingUsername?: string;
  /** Display name (full_name preferred, else username). Null until accepted. */
  incomingUsername?: string;
  createdByBoundary?: boolean;
  subProcess?: string;
  motherCoil?: string;
  coilNo?: string;
  slitId?: string;
}

export interface MachineHeadDashboardData {
  orderQueue: LiveOrderRow[];
  shiftSummary: {
    shiftCode: string;
    /** Operational production date from shift detection (not PPC plan_date). */
    prodDate: string;
    targetMt: number;
    /** Total saved production MT (completed + in-progress). */
    actualMt: number;
    completedProdMt?: number;
    inProgressMt?: number;
    totalProdMt?: number;
    /** PPC weight MT still in the live machine queue (not completed output). */
    queuedMt: number;
    /** Current-shift production orders (completed + in-progress on this shift_log). */
    orderCount: number;
    completedOrderCount: number;
  };
  runtimeUtilization: MachineRuntimeUtilizationRow[];
  stoppages: MachineHeadStoppageRow[];
  operatorActivity: MachineHeadOperatorRow[];
  productionHistory: MachineHeadProductionRow[];
  handoverOverview?: {
    pending: HandoverOverviewRow[];
    recent: HandoverOverviewRow[];
    awaitingAcceptance: number;
  };
  rejectedOrders?: {
    batchNumber: string;
    machineCode: string;
    rejectionTime: string;
    reason: string;
    rejectedBy: string;
    weightMt: number;
    shiftCode?: string;
    planDate?: string;
    subProcess?: string;
    motherCoil?: string;
    coilNo?: string;
    slitId?: string;
  }[];
  rejectedOrderCount?: number;
  /** Open MH desk notifications (SPEC2 §10 auto-handover alerts). */
  deskNotifications?: Array<{
    notificationId: string;
    kind: string;
    title: string;
    body: string;
    machineCode: string | null;
    handoverId: string | null;
    shiftLogId: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

export interface LiveSnapshot {
  kpis: LiveKpis;
  machines: MachineStatusCard[];
  refreshedAt: string;
}

export interface LiveOrderDetail extends LiveOrderRow {
  widthMm: number;
  inputThkMm?: number;
  targetThkMm: number;
  sapOrderNo?: string;
  processRouteLabels?: string;
  currentShiftWindow?: string;
  journey?: OrderJourneyView;
  stoppages: {
    id: string;
    category: string;
    breakdownCode?: string;
    startAt: string;
    endAt?: string;
    durationMin?: number;
    remarks?: string;
  }[];
  remarks: { id: string; text: string; createdAt: string; operatorName?: string }[];
  productionHistory: { step: string; completedAt?: string; status: string }[];
  rejection?: OrderRejectionInfo;
}

export interface RejectedOrderRow {
  batchNumber: string;
  machineCode: string;
  rejectionTime: string;
  reason: string;
  rejectedBy: string;
  weightMt: number;
  shiftCode?: string;
  planDate?: string;
  subProcess?: string;
  coilNo?: string;
  motherCoil?: string;
  slitId?: string;
}

export interface MachineAccessEntry {
  userId: string;
  username: string;
  displayName: string;
  role?: string;
  machines: { machineCode: string; machineName: string; accessLevel: string }[];
  lineAccess: { lineId: string; level: string }[];
}
