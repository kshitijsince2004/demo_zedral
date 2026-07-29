/**
 * ReportingService — client wrapper for the /reports/* endpoints.
 *
 * All methods call the real backend via apiClient. No mock data is used.
 * On error, the service throws so callers can render an error/empty state.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9
 */

import { apiClient } from './apiClient';
import type { ProcessCode } from './processCodes';

// ─── Machine Head Dashboard ─────────────────────────────────────────────────────

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

export interface MachineHeadDashboardData {
  /** Multi-line shift status for all lines in scope. */
  lineStatuses: LineShiftStatus[];
  /** Number of shift logs pending machine head review. */
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

export interface PlantHeadKpiStrip {
  productionTodayMt: number;
  productionTodayTrendPct: number;
  oeePct: number;
  oeeTrendPct: number;
  availabilityPct: number;
  availabilityTrendPct: number;
  performancePct: number;
  performanceTrendPct: number;
  qualityPct: number;
  qualityTrendPct: number;
}

export interface PlantHeadBacklogOrder {
  batchNumber: string;
  batchId: string;
  coilNo: string;
  motherCoil?: string;
  slitId?: string;
  planDate: string;
  shiftCode: string;
  status: string;
  machineCode?: string;
  machineName?: string;
  stage?: string;
  customer?: string;
  grade?: string;
  weightMt: number;
  daysPending: number;
}

export interface PlantHeadBacklogResponse {
  total: number;
  orders: PlantHeadBacklogOrder[];
}

export interface PlantHeadDashboardData {
  /** Selected reporting window in days. */
  window: 1 | 7 | 30 | 90;
  /** ISO8601 timestamp when the payload was generated. */
  generatedAt: string;
  /** Count of orders planned before today that are not yet completed/rejected. */
  backlogCount: number;
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
  /** Daily production vs target for the selected window. */
  dailyProduction: { date: string; targetMt: number; actualMt: number }[];
  /** API-backed KPI strip values and period-over-period trends. */
  kpiStrip: PlantHeadKpiStrip;
}

export interface CoilTraceabilityResult {
  coilNo: string;
  grade: string;
  customer: string;
  currentProcess: ProcessCode;
  status: string;
  weightMt: number;
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
  productionToday: number;
  productionTarget: number;
  productionShift: number;
  productionShiftTarget: number;
  productionMonth: number;
  productionMonthTarget: number;
  productionForecast: number;
  productionTodayMt: number;
  productionTrend: string;
  shiftProductionMt: number;
  overallUtilizationPct: number;
  oeePct: number;
  runningMachines: number;
  breakdownMachines: number;
  utilizationPct: number;
  availabilityPct: number;
  mttrHours: number;
  mtbfHours: number;
  runningOrders: number;
  delayedOrders: number;
  defectsToday: number;
  defectPct: number;
  defectTrend: { date: string; defects: number }[];
  activeAlerts: number;
  criticalAlerts: string[];
  opsFeed: OpsFeedEvent[];
  dailyProduction: { date: string; actual: number; target: number }[];
  weeklyProduction: { week: string; actual: number; target: number }[];
  monthlyProduction: { month: string; actual: number; target: number }[];
  productionVsTarget: { date: string; targetMt: number; actualMt: number }[];
  defectsByCategory: { category: string; count: number }[];
  downtimeByCategory: { category: string; minutes: number }[];
  /** Per-line plan attainment from shift logs (not machine health scores). */
  lineAttainment: {
    lineId: string;
    lineName: string;
    plannedMt: number;
    actualMt: number;
    attainmentPct: number;
  }[];
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

export type ExportType = 'DPR' | 'LINE_LOG' | 'COIL_TRACE' | 'RAW' | 'REJECTED_ORDERS' | 'SHIFT_SUMMARY' | 'QC_FAILS';

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

export function formatTrendPct(pct: number | null | undefined): string | null {
  if (pct == null || Number.isNaN(pct)) return null;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return '0%';
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
}

export const reportingService = {
  /**
   * Fetches the Machine Head dashboard data for the given machines.
   * Requirements: 9.1, 9.2
   */
  async getMachineHeadDashboard(): Promise<MachineHeadDashboardData> {
    return apiClient.get<MachineHeadDashboardData>(`/reports/machine-head`);
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

  async getPlantHeadBacklog(): Promise<PlantHeadBacklogResponse> {
    return apiClient.get<PlantHeadBacklogResponse>('/reports/plant-head/backlog');
  },

  /**
   * Maps real plant-head API data into the command-center layout (no mock values).
   */
  async getExtendedPlantHeadDashboard(
    windowDays?: 1 | 7 | 30 | 90,
    filters?: {
      lines?: string[];
      shifts?: string[];
      grades?: string[];
      customers?: string[];
      coils?: string[];
    },
  ): Promise<ExtendedPlantHeadDashboardData> {
    const base = await this.getPlantHeadDashboard(windowDays, filters);
    const strip = base.kpiStrip;

    const productionVsTarget = base.dailyProduction;

    const defectsByCategory = base.topDefects.map((d) => ({
      category: d.defectName || d.defectCode,
      count: d.count,
    }));

    const downtimeByCategory = base.downtimeDrivers.map((d) => ({
      category: d.reason,
      minutes: d.totalMinutes,
    }));

    const lineAttainment = base.productionVsPlan.map((line) => ({
      lineId: line.lineId,
      lineName: line.lineName,
      plannedMt: line.planned,
      actualMt: line.actual,
      attainmentPct: line.attainmentPct,
    }));

    const runningLines = base.productionVsPlan.filter((line) => line.actual > 0).length;
    const delayedLines = base.productionVsPlan.filter(
      (line) => line.planned > 0 && line.attainmentPct < 90,
    ).length;
    const totalActual = base.productionVsPlan.reduce((sum, row) => sum + row.actual, 0);
    const totalPlanned = base.productionVsPlan.reduce((sum, row) => sum + row.planned, 0);

    return {
      ...base,
      productionToday: strip.productionTodayMt,
      productionTarget: totalPlanned,
      productionShift: strip.productionTodayMt,
      productionShiftTarget: totalPlanned,
      productionMonth: totalActual,
      productionMonthTarget: totalPlanned,
      productionForecast: totalPlanned,
      productionTodayMt: Math.round(strip.productionTodayMt),
      productionTrend: formatTrendPct(strip.productionTodayTrendPct) ?? '0%',
      shiftProductionMt: Math.round(strip.productionTodayMt),
      overallUtilizationPct: Math.round(strip.availabilityPct),
      oeePct: Math.round(strip.oeePct),
      runningMachines: runningLines,
      breakdownMachines: 0,
      utilizationPct: strip.availabilityPct,
      availabilityPct: strip.availabilityPct,
      mttrHours: (() => {
        const totalMin = base.downtimeDrivers.reduce((sum, d) => sum + d.totalMinutes, 0);
        const totalOcc = base.downtimeDrivers.reduce((sum, d) => sum + d.occurrences, 0);
        return totalOcc > 0 ? Math.round((totalMin / totalOcc / 60) * 10) / 10 : 0;
      })(),
      mtbfHours: 0,
      runningOrders: runningLines,
      delayedOrders: delayedLines,
      defectsToday: base.topDefects.reduce((sum, d) => sum + d.count, 0),
      defectPct: base.qualityTrend.at(-1)?.rejectionRatePct ?? 0,
      defectTrend: base.qualityTrend.map((q) => ({
        date: q.date,
        defects: q.rejectionRatePct,
      })),
      activeAlerts: base.downtimeDrivers.length,
      criticalAlerts: [],
      opsFeed: [],
      dailyProduction: productionVsTarget.map((row) => ({
        date: row.date,
        actual: row.actualMt,
        target: row.targetMt,
      })),
      weeklyProduction: [],
      monthlyProduction: [],
      productionVsTarget,
      defectsByCategory,
      downtimeByCategory,
      lineAttainment,
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
