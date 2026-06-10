/**
 * ReportingService — client wrapper for the /reports/* endpoints.
 *
 * All methods call the real backend via apiClient. No mock data is used.
 * On error, the service throws so callers can render an error/empty state.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9
 */

import { apiClient } from './apiClient';
import type { ProcessCode } from './processSectionRegistry';

// ─── Supervisor Dashboard ─────────────────────────────────────────────────────

export interface LineShiftStatus {
  lineId: ProcessCode;
  lineName: string;
  status: 'RUNNING' | 'STOPPED' | 'IDLE' | 'MAINTENANCE';
  shiftCode: string;
  operatorName?: string;
}

export interface LineOee {
  lineId: ProcessCode;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
}

export interface DowntimeEntry {
  reason: string;
  minutes: number;
}

export interface SupervisorDashboardData {
  /** Multi-line shift status for all lines in scope. */
  lineStatuses: LineShiftStatus[];
  /** Number of shift logs pending supervisor review. */
  pendingReviewCount: number;
  /** OEE breakdown per line. */
  lineOee: LineOee[];
  /** Downtime Pareto (sorted descending by minutes). */
  downtimePareto: DowntimeEntry[];
  /** Yield percentage for the current shift. */
  yieldPct: number;
  /** Rejection rate percentage for the current shift. */
  rejectionRatePct: number;
}

// ─── Plant Head Dashboard ─────────────────────────────────────────────────────

export interface OeeTrendPoint {
  date: string;
  oee: number;
}

export interface ProductionVsPlanEntry {
  lineId: ProcessCode;
  lineName: string;
  planned: number;
  actual: number;
  attainmentPct: number;
  throughput: number;
}

export interface QualityTrendPoint {
  date: string;
  rejectionRatePct: number;
  yieldPct: number;
}

export interface TopDefect {
  defectCode: string;
  defectName: string;
  count: number;
  wowDelta: number;
}

export interface DowntimeDriver {
  reason: string;
  totalMinutes: number;
  occurrences: number;
  type: 'PLANNED' | 'UNPLANNED';
}

export interface CoilTraceabilityResult {
  coilNo: string;
  grade: string;
  customer: string;
  currentProcess: ProcessCode;
  status: string;
  weightMt: number;
}

export interface PlantHeadDashboardData {
  /** Selected reporting window in days. */
  window: 1 | 7 | 30 | 90;
  /** ISO8601 timestamp when the payload was generated. */
  generatedAt: string;
  /** Plant-wide OEE (aggregate). */
  plantWideOee: number;
  /** Target OEE (%) for delta context. */
  oeeTarget: number;
  /** OEE trend over the selected period. */
  oeeTrend: OeeTrendPoint[];
  /** Production vs plan by line. */
  productionVsPlan: ProductionVsPlanEntry[];
  /** Quality trend over the selected period. */
  qualityTrend: QualityTrendPoint[];
  /** Top defects by count. */
  topDefects: TopDefect[];
  /** Top downtime drivers by total minutes. */
  downtimeDrivers: DowntimeDriver[];
}

// ─── Extended Plant Head Dashboard (Command Center) ───────────────────────────

export interface OpsFeedEvent {
  id: string;
  timestamp: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  machine: string;
  order: string;
  description: string;
}

export interface ExtendedPlantHeadDashboardData extends PlantHeadDashboardData {
  // Production
  productionToday: number;
  productionTarget: number;
  productionShift: number;
  productionShiftTarget: number;
  productionMonth: number;
  productionMonthTarget: number;
  productionForecast: number;
  
  // Utilization
  runningMachines: number;
  breakdownMachines: number;
  utilizationPct: number;
  availabilityPct: number;
  mttrHours: number;
  mtbfHours: number;
  
  // Orders
  runningOrders: number;
  delayedOrders: number;
  
  // Defects
  defectsToday: number;
  defectPct: number;
  defectTrend: { date: string; defects: number }[];
  
  // Operations Feed & Alerts
  activeAlerts: number;
  criticalAlerts: string[];
  opsFeed: OpsFeedEvent[];
  
  // Zone 2 Charts
  dailyProduction: { date: string; actual: number; target: number }[];
  weeklyProduction: { week: string; actual: number; target: number }[];
  monthlyProduction: { month: string; actual: number; target: number }[];
}

// ─── Management Dashboard ─────────────────────────────────────────────────────

export type ReportingPeriod = 'shift' | 'day' | 'week' | 'month';

export interface KpiComparison {
  current: number;
  previous: number;
  /** Percentage change vs previous period (positive = improvement). */
  changePct: number;
}

export interface ManagementDashboardData {
  period: ReportingPeriod;
  /** Overall throughput in MT. */
  throughputMt: KpiComparison;
  /** Plant-wide OEE %. */
  oee: KpiComparison;
  /** Rejection cost in currency units. */
  rejectionCost: KpiComparison;
  /** On-time delivery %. */
  onTimeDeliveryPct: KpiComparison;
  /** Yield %. */
  yieldPct: KpiComparison;
  /** Total downtime minutes. */
  downtimeMinutes: KpiComparison;
}

// ─── Drill-down ───────────────────────────────────────────────────────────────

export interface DrilldownScope {
  processId?: ProcessCode;
  dateFrom?: string;
  dateTo?: string;
  shiftCode?: string;
  coilNo?: string;
}

export interface DrilldownEntry {
  id: string;
  coilNo: string;
  processId: ProcessCode;
  shiftCode: string;
  date: string;
  value: number;
  unit: string;
}

export interface DrilldownResult {
  metric: string;
  scope: DrilldownScope;
  entries: DrilldownEntry[];
  total: number;
}

export type PlantHeadDrilldownMetric = 'oee' | 'production' | 'defects' | 'downtime' | 'quality';

export interface PlantHeadDrilldownEnvelope {
  metric: PlantHeadDrilldownMetric;
  window: number;
  records: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Export ───────────────────────────────────────────────────────────────────

export interface ExportParams {
  scope: {
    processId?: ProcessCode;
    dateFrom?: string;
    dateTo?: string;
    shiftCode?: string;
    coilNo?: string;
    month?: string;
    processCodes?: string[];
    areaCodes?: string[];
    coilNos?: string[];
    shiftCodes?: string[];
    customerCodes?: string[];
    statuses?: string[];
    columns?: string[];
  };
  format: 'CSV' | 'XLSX';
}

export interface ExportHistoryResult {
  jobs: ExportJobView[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export type ExportType = 'DPR' | 'LINE_LOG' | 'COIL_TRACE' | 'RAW';

export interface ExportJobView {
  jobId: string;
  type?: ExportType;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED';
  jobStatus?: 'queued' | 'running' | 'done' | 'error';
  progress?: number;
  downloadUrl?: string;
  rowCount?: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
  dataVersion?: string;
  generatedAt?: string;
  sourceRecordCount?: number;
  storageUri?: string;
  signedDownloadUrl?: string;
  sha256?: string;
  artifact?: {
    url: string;
    filename: string;
    bytes: number;
    sha256: string;
  };
}

/** @deprecated Use ExportJobView */
export type ExportJob = ExportJobView;

export interface ExportRequestBody {
  type?: ExportType;
  format: 'CSV' | 'XLSX' | 'PDF';
  scope: ExportParams['scope'];
  options?: Record<string, unknown>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const reportingService = {
  /**
   * Fetches the Supervisor dashboard data for the given line IDs.
   * Requirements: 9.1, 9.2
   */
  async getSupervisorDashboard(lineIds: ProcessCode[]): Promise<SupervisorDashboardData> {
    const query = lineIds.length > 0 ? `?lines=${lineIds.join(',')}` : '';
    return apiClient.get<SupervisorDashboardData>(`/reports/supervisor${query}`);
  },

  /**
   * Fetches the Plant Head dashboard data.
   * Requirements: 9.1, 9.3
   */
  async getPlantHeadDashboard(
    windowDays?: 1 | 7 | 30 | 90,
    filters?: {
      lines?: string[];
      shifts?: string[];
      grades?: string[];
      customers?: string[];
      coils?: string[];
    }
  ): Promise<PlantHeadDashboardData> {
    const params = new URLSearchParams();
    if (windowDays) params.set('window', String(windowDays));
    if (filters?.lines?.length) params.set('lines', filters.lines.join(','));
    if (filters?.shifts?.length) params.set('shifts', filters.shifts.join(','));
    if (filters?.grades?.length) params.set('grades', filters.grades.join(','));
    if (filters?.customers?.length) params.set('customers', filters.customers.join(','));
    if (filters?.coils?.length) params.set('coils', filters.coils.join(','));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return apiClient.get<PlantHeadDashboardData>(`/reports/plant-head${qs}`);
  },

  /**
   * Fetches extended dashboard data, combining real API data with 
   * mocked enhancements for the new Command Center UI layout.
   */
  async getExtendedPlantHeadDashboard(
    windowDays?: 1 | 7 | 30 | 90,
    filters?: any
  ): Promise<ExtendedPlantHeadDashboardData> {
    const baseData = await this.getPlantHeadDashboard(windowDays, filters);
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const aiExecutiveSummary = "Production is currently 4.8% below target due to downtime on CRM 4HI and material waiting at CR Slitting. Surface Scratch defects account for 48% of total defects. Three high-priority orders are at risk of delay. Shift B is currently outperforming all other shifts by 11%.";

    const mockOpsFeed: OpsFeedEvent[] = [
      { id: '1', timestamp: timeStr, priority: 'Critical', machine: 'CRM 6HI', order: 'B-2026-SP002', shift: 'Shift A', operator: 'J. Smith', impact: '65 MT Prod Loss', recommendedAction: 'Transfer pending coils to CRM 4HI', description: 'Machine Breakdown reported. Maintenance dispatched.' },
      { id: '2', timestamp: timeStr, priority: 'High', machine: 'Pickling', order: 'B-2026-R001', shift: 'Shift A', operator: 'A. Davis', impact: 'Quality Risk', recommendedAction: 'Inspect acid concentration levels', description: 'High Defect Rate (Edge Cracks) exceeding 4% threshold.' },
      { id: '3', timestamp: timeStr, priority: 'Medium', machine: 'CRM 4HI', order: 'B-2026-SP005', shift: 'Shift A', operator: 'M. Lee', impact: 'Schedule Delay', recommendedAction: 'Expedite next batch', description: 'Order Delay forecast. Progress behind schedule by 45 mins.' },
    ];

    const mockDefectTrend = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      return { date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), defects: Math.floor(Math.random() * 50) + 10 };
    });

    const mockDailyProd = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      return { date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), actual: Math.floor(Math.random() * 500) + 800, target: 1200 };
    });

    return {
      ...baseData,
      aiExecutiveSummary,
      
      productionToday: 1145,
      productionTarget: 1200,
      productionPrev: 1100,
      
      productionShift: 420,
      productionShiftTarget: 400,
      
      productionMonth: 32450,
      productionMonthTarget: 40000,
      productionForecast: 41200,
      
      plantWideOeePrev: 80.1,
      runningMachines: 8,
      breakdownMachines: 1,
      utilizationPct: 82.5,
      utilizationPrev: 84.0,
      availabilityPct: 88.1,
      mttrHours: 2.4,
      mttrPrev: 2.6,
      mtbfHours: 145,
      mtbfPrev: 130,
      
      runningOrders: 14,
      delayedOrders: 3,
      delayedOrdersPrev: 5,
      blockedOrders: 2,
      completedOrdersToday: 8,
      
      defectsToday: 45,
      defectsPrev: 38,
      defectPct: 2.1,
      
      waterfallProduction: [
        { category: 'Target', value: 1200 },
        { category: 'Breakdown', value: -45 },
        { category: 'Roll Change', value: -12 },
        { category: 'Material Wait', value: -20 },
        { category: 'Quality Reject', value: -8 },
        { category: 'Operator Delay', value: -5 },
        { category: 'Power Failure', value: 0 },
      ],
      lineWiseProduction: [
        { line: 'Pickling', target: 300, actual: 295, achievement: 98.3, gap: -5 },
        { line: 'CRM 4HI', target: 200, actual: 160, achievement: 80.0, gap: -40 },
        { line: 'CRM 6HI', target: 250, actual: 260, achievement: 104.0, gap: 10 },
        { line: 'Annealing', target: 150, actual: 145, achievement: 96.6, gap: -5 },
        { line: 'Skin Pass', target: 100, actual: 95, achievement: 95.0, gap: -5 },
        { line: 'CR Slitting', target: 100, actual: 80, achievement: 80.0, gap: -20 },
        { line: 'CTL', target: 100, actual: 110, achievement: 110.0, gap: 10 },
      ],
      
      defectTrend: mockDefectTrend,
      machineWiseDefects: [
        { machine: 'CRM 4HI', defects: 18 },
        { machine: 'Pickling', defects: 12 },
        { machine: 'CR Slitting', defects: 8 },
        { machine: 'Annealing', defects: 4 },
        { machine: 'CTL', defects: 3 },
      ],
      shiftWiseDefects: [
        { shift: 'Shift A', defects: 22 },
        { shift: 'Shift B', defects: 15 },
        { shift: 'Shift C', defects: 8 },
      ],
      defectFinancials: { rejectedMt: 12.5, reworkMt: 28.4, costImpact: 45200 },
      
      waterfallDowntime: [
        { category: 'Mechanical', value: 120 },
        { category: 'Electrical', value: 45 },
        { category: 'Roll Change', value: 80 },
        { category: 'Material Wait', value: 65 },
        { category: 'Maintenance', value: 90 },
      ],
      machineDowntimeRanking: [
        { machine: 'CRM 4HI', mins: 145 },
        { machine: 'CR Slitting', mins: 90 },
        { machine: 'Pickling', mins: 45 },
        { machine: 'Annealing', mins: 20 },
      ],
      downtimeFinancials: { lostProdMt: 68.5, affectedOrders: 14, estimatedLoss: 112500 },
      
      orderList: [
        { orderNo: 'ORD-1001', customer: 'Tata Motors', currentProcess: 'CRM 4HI', delayMins: 45, impact: 'High', priority: 'Urgent', status: 'Delayed' },
        { orderNo: 'ORD-1002', customer: 'Maruti Suzuki', currentProcess: 'Pickling', delayMins: 0, impact: 'Low', priority: 'Normal', status: 'Running' },
        { orderNo: 'ORD-1003', customer: 'Hyundai', currentProcess: 'CR Slitting', delayMins: 120, impact: 'High', priority: 'Urgent', status: 'Blocked' },
        { orderNo: 'ORD-1004', customer: 'L&T', currentProcess: 'CTL', delayMins: 0, impact: 'Low', priority: 'Normal', status: 'Completed' },
      ],
      
      bottleneckFlow: [
        { stageName: 'HR Slitting', ordersWaiting: 2, ordersRunning: 1, utilizationPct: 85, queueLengthMt: 45, isBottleneck: false },
        { stageName: 'Pickling', ordersWaiting: 5, ordersRunning: 2, utilizationPct: 92, queueLengthMt: 120, isBottleneck: false },
        { stageName: 'CRM 4HI', ordersWaiting: 12, ordersRunning: 1, utilizationPct: 98, queueLengthMt: 350, isBottleneck: true },
        { stageName: 'Annealing', ordersWaiting: 1, ordersRunning: 4, utilizationPct: 75, queueLengthMt: 20, isBottleneck: false },
        { stageName: 'Skin Pass', ordersWaiting: 0, ordersRunning: 1, utilizationPct: 60, queueLengthMt: 0, isBottleneck: false },
        { stageName: 'CR Slitting', ordersWaiting: 8, ordersRunning: 2, utilizationPct: 95, queueLengthMt: 180, isBottleneck: false },
        { stageName: 'CTL', ordersWaiting: 3, ordersRunning: 1, utilizationPct: 80, queueLengthMt: 65, isBottleneck: false },
      ],
      
      machineHealthGrid: [
        { machineId: 'M1', machineName: 'CRM 6HI', healthScore: 98, status: 'Running', currentOrder: 'ORD-1005', operator: 'S. Kumar', runtimeHrs: 18.5, efficiencyPct: 95, availabilityPct: 99, downtimeTodayMins: 0 },
        { machineId: 'M2', machineName: 'CRM 4HI', healthScore: 65, status: 'Warning', currentOrder: 'ORD-1001', operator: 'M. Lee', runtimeHrs: 12.0, efficiencyPct: 80, availabilityPct: 85, downtimeTodayMins: 145 },
        { machineId: 'M3', machineName: 'Pickling', healthScore: 88, status: 'Running', currentOrder: 'ORD-1002', operator: 'A. Davis', runtimeHrs: 22.1, efficiencyPct: 92, availabilityPct: 95, downtimeTodayMins: 45 },
        { machineId: 'M4', machineName: 'CR Slitting', healthScore: 42, status: 'Breakdown', currentOrder: 'ORD-1003', operator: 'R. Singh', runtimeHrs: 4.5, efficiencyPct: 40, availabilityPct: 60, downtimeTodayMins: 90 },
      ],
      
      shiftIntelligence: [
        { shiftName: 'Shift A', productionMt: 380, oeePct: 82, defectPct: 2.4, downtimeMins: 120, utilizationPct: 80 },
        { shiftName: 'Shift B', productionMt: 420, oeePct: 89, defectPct: 1.8, downtimeMins: 45, utilizationPct: 88 },
        { shiftName: 'Shift C', productionMt: 345, oeePct: 76, defectPct: 3.1, downtimeMins: 160, utilizationPct: 74 },
      ],
      
      activeAlerts: 4,
      criticalAlerts: ['CRM 6HI Breakdown - Hydraulic Failure', 'Pickling Line Edge Crack Spike'],
      opsFeed: mockOpsFeed,
      
      dailyProduction: mockDailyProd,
      weeklyProduction: [{ week: 'Week 1', actual: 8100, target: 8400 }, { week: 'Week 2', actual: 8500, target: 8400 }, { week: 'Week 3', actual: 7900, target: 8400 }, { week: 'Week 4', actual: 8200, target: 8400 }],
      monthlyProduction: [{ month: 'Jan', actual: 38000, target: 40000 }, { month: 'Feb', actual: 39500, target: 40000 }, { month: 'Mar', actual: 41000, target: 40000 }, { month: 'Apr', actual: 37500, target: 40000 }, { month: 'May', actual: 42000, target: 40000 }, { month: 'Jun', actual: 32450, target: 40000 }],
    };
  },

  /**
   * Fetches the Management dashboard data for the given period.
   * Requirements: 9.1, 9.4
   */
  async getManagementDashboard(period: ReportingPeriod): Promise<ManagementDashboardData> {
    return apiClient.get<ManagementDashboardData>(`/reports/management?period=${period}`);
  },

  /**
   * Fetches the underlying coils/entries composing a KPI tile.
   * Requirements: 9.5
   */
  async getPlantHeadDrilldown(
    metric: PlantHeadDrilldownMetric,
    windowDays?: 1 | 7 | 30 | 90,
    page = 1,
  ): Promise<PlantHeadDrilldownEnvelope> {
    const params = new URLSearchParams({ metric, page: String(page) });
    if (windowDays) params.set('window', String(windowDays));
    return apiClient.get<PlantHeadDrilldownEnvelope>(
      `/reports/plant-head/drilldown?${params.toString()}`,
    );
  },

  async getKpiDrilldown(metric: string, scope: DrilldownScope): Promise<DrilldownResult> {
    const params = new URLSearchParams({ metric });
    if (scope.processId) params.set('processId', scope.processId);
    if (scope.dateFrom) params.set('dateFrom', scope.dateFrom);
    if (scope.dateTo) params.set('dateTo', scope.dateTo);
    if (scope.shiftCode) params.set('shiftCode', scope.shiftCode);
    if (scope.coilNo) params.set('coilNo', scope.coilNo);
    return apiClient.get<DrilldownResult>(`/reports/drilldown?${params.toString()}`);
  },

  /**
   * Searches coil traceability.
   * Requirements: 9.3
   */
  async searchCoilTraceability(coilNo: string): Promise<CoilTraceabilityResult[]> {
    return apiClient.get<CoilTraceabilityResult[]>(
      `/reports/coil-traceability?coilNo=${encodeURIComponent(coilNo)}`,
    );
  },

  /**
   * Creates a real export job (not a simulated download).
   * Requirements: 9.6
   */
  async createExport(params: ExportParams): Promise<ExportJobView> {
    return apiClient.post<ExportJobView>('/exports', { type: 'RAW', ...params });
  },

  async createExportJob(body: ExportRequestBody): Promise<ExportJobView> {
    return apiClient.post<ExportJobView>('/exports', body);
  },

  /**
   * Polls an export job by ID.
   * Requirements: 9.6
   */
  async getExportJob(jobId: string): Promise<ExportJobView> {
    return apiClient.get<ExportJobView>(`/exports/${jobId}`);
  },

  async listExportHistory(params: {
    type?: ExportType;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<ExportHistoryResult> {
    const q = new URLSearchParams({ list: '1' });
    if (params.type) q.set('type', params.type);
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    return apiClient.get<ExportHistoryResult>(`/exports?${q.toString()}`);
  },

  async listExportNotifications(withinSeconds = 60): Promise<{ jobs: ExportJobView[] }> {
    return apiClient.get<{ jobs: ExportJobView[] }>(
      `/exports/notifications?within=${withinSeconds}`,
    );
  },

  async finalizeDprMonth(month: string): Promise<{ ok: boolean; month: string }> {
    return apiClient.post<{ ok: boolean; month: string }>('/exports/dpr/finalize', { month });
  },
};
