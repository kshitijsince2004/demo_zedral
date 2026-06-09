/** Canonical read-model row shapes consumed by aggregation (Phase 1). */

export type DprStoppageCategory =
  | 'ELECTRICAL'
  | 'MECHANICAL'
  | 'OPERATIONAL'
  | 'EQUIPMENT_AVAILABILITY'
  | 'PREVENTIVE_MAINTENANCE'
  | 'POWER_FAILURE'
  | 'NO_PLAN'
  | 'RM_SHORTAGE';

export type StoppageAgency = 'OP' | 'EL' | 'MECH';

export type ProcessRunStatus = 'OK' | 'HOLD' | 'REJECT' | 'FOR_CTL';

export interface ExportReadScope {
  dateFrom: string;
  dateTo: string;
  shiftCode?: string;
  areaCode?: string;
  processCode?: string;
  coilNo?: string;
}

/** Normalized process_run equivalent — one coil pass per shift. */
export interface ProcessRunRow {
  runId: string;
  coilNo: string;
  processCode: string;
  areaCode: string;
  prodDate: string;
  shiftCode: string;
  operatorCode: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  outputWeightMt: number | null;
  outputThkMm: number | null;
  status: ProcessRunStatus;
  sourceTable: string;
  sourceEntryId: string;
  attrs?: Record<string, unknown>;
}

export interface StoppageEventRow {
  eventId: string;
  areaCode: string;
  prodDate: string;
  shiftCode: string;
  minutes: number;
  agencyCode: StoppageAgency;
  reasonCode: string;
  reasonLabel: string;
  dprCategory: DprStoppageCategory;
  remark: string | null;
}

export interface DispositionRow {
  areaCode: string;
  prodDate: string;
  shiftCode: string;
  coilNo: string | null;
  scrapMt: number;
  internalRejMt: number;
  bSlitMt: number;
  trimMt: number;
}

export interface ProductionTargetRow {
  areaCode: string;
  period: string;
  targetMt: number | null;
  targetRate: number | null;
}

export interface CoilLineageNode {
  coilNo: string;
  parentCoilNo: string | null;
  forCtlFlag: boolean;
  gradeCode: string | null;
  weightMt: number | null;
}
