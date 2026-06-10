import { apiClient } from './apiClient';

export type TraceabilityHistoryEntry = {
  process: string;
  coilNo: string;
  record: Record<string, unknown>;
  stoppages?: unknown[];
  siblings?: string[];
};

export type TraceabilitySearchResult = {
  query: string;
  targetCoilNo: string;
  lineage: string[];
  history: TraceabilityHistoryEntry[];
  orderInfo: {
    batchNumber: string;
    coilNo: string;
    slitId?: string | null;
    customer: string;
    grade: string;
    subProcess: string;
    machineCode: string;
    machineAllocated: boolean;
    planDate: string;
    shiftCode: string;
    weightMt: number;
    targetThkMm: number;
    inputThkMm?: number | null;
    sapOrderNo?: string | null;
    status: string;
    importBatchId?: number | null;
  } | null;
  machineJourney: {
    step: number;
    process: string;
    machine: string | null;
    status: string;
    completedAt?: string | null;
  }[];
  searchedBy: string;
};

export type SuggestionResult = {
  text: string;
  type: 'batch' | 'coil' | 'sap_order' | 'slit';
  score: number;
};

export const traceabilityService = {
  search: (query: string) =>
    apiClient.get<TraceabilitySearchResult>(`/traceability?q=${encodeURIComponent(query.trim())}`),
  suggest: (query: string) =>
    apiClient.get<SuggestionResult[]>(`/traceability/suggest?q=${encodeURIComponent(query.trim())}`),
};
