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
  async getPlantHeadDashboard(windowDays?: 1 | 7 | 30 | 90): Promise<PlantHeadDashboardData> {
    const query = windowDays ? `?window=${windowDays}` : '';
    return apiClient.get<PlantHeadDashboardData>(`/reports/plant-head${query}`);
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
