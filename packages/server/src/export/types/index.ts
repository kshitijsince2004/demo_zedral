export type ExportType =
  | 'DPR'
  | 'LINE_LOG'
  | 'COIL_TRACE'
  | 'RAW'
  | 'REJECTED_ORDERS'
  | 'SHIFT_SUMMARY'
  | 'QC_FAILS'
  | 'ANN_CHARGE_REPORT';

export * from './rdm';

export type ExportFormat = 'CSV' | 'XLSX' | 'PDF';

/** Persisted job status (audit.export_job.job_status). */
export type ExportJobStatus = 'queued' | 'running' | 'done' | 'error';

/** Client-facing status (backward compatible with pilot UI). */
export type ExportClientStatus = 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED';

export interface RawExportScope {
  processId?: string;
  dateFrom?: string;
  dateTo?: string;
  shiftCode?: string;
  coilNo?: string;
  processCodes?: string[];
  areaCodes?: string[];
  coilNos?: string[];
  shiftCodes?: string[];
  customerCodes?: string[];
  statuses?: string[];
  columns?: string[];
}

export interface ExportRequest {
  type: ExportType;
  format: ExportFormat;
  scope: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface ExportArtifactMeta {
  url: string;
  filename: string;
  bytes: number;
  sha256: string;
}

export interface ExportJobView {
  jobId: string;
  type: ExportType;
  status: ExportClientStatus;
  jobStatus: ExportJobStatus;
  progress: number;
  downloadUrl?: string;
  rowCount?: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
  artifact?: ExportArtifactMeta;
  dataVersion?: string;
  generatedAt?: string;
  sourceRecordCount?: number;
  storageUri?: string;
  signedDownloadUrl?: string;
}

export interface RenderSheet {
  name: string;
  rows: Record<string, unknown>[];
}

export interface RenderGridSheet {
  name: string;
  cells: Array<{ row: number; col: number; value: string | number | null }>;
}

export interface ReportExecutionResult {
  rows: Record<string, unknown>[];
  filename: string;
  sheets?: RenderSheet[];
  gridSheets?: RenderGridSheet[];
  /** Pre-rendered XLSX from template injection (preserves styles/formulas). */
  templateBuffer?: Buffer;
  dataVersion?: string;
  /** When true, renderer uses fixed metadata timestamp for reproducible sha256. */
  deterministic?: boolean;
  /** Column keys for CSV header (streaming path). */
  columns?: string[];
  rowCount?: number;
  /** Async generator for batched CSV streaming. */
  streamBatches?: () => AsyncGenerator<Record<string, unknown>[]>;
  /** HTML payload for PDF renderer (E2 line logs, E3 coil trace). */
  html?: string;
  generatedAt?: string;
  sourceRecordCount?: number;
}
