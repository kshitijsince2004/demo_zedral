import type { ExportFormat, ExportType } from '../types';
import type { ReportDefinition } from './ReportDefinition';
import { DprReport } from './DprReport';
import { CoilTraceReport } from './CoilTraceReport';
import { LineLogReport } from './LineLogReport';
import { RawRegisterReport } from './RawRegisterReport';

const REGISTRY: Record<ExportType, ReportDefinition> = {
  RAW: RawRegisterReport,
  DPR: DprReport,
  LINE_LOG: LineLogReport,
  COIL_TRACE: CoilTraceReport,
};

function stubDefinition(id: ExportType, formats: ExportFormat[]): ReportDefinition {
  return {
    id,
    validateScope() {
      throw new Error(`${id} export is not implemented yet`);
    },
    supportedFormats: () => formats,
    async estimateRowCount() {
      return 0;
    },
    async execute() {
      throw new Error(`${id} export is not implemented yet`);
    },
  };
}

export function getReportDefinition(type: ExportType): ReportDefinition {
  const def = REGISTRY[type];
  if (!def) throw new Error(`Unknown export type: ${type}`);
  return def;
}

export { RawRegisterReport };
export { DprReport, buildDprFromFixture } from './DprReport';
export * from './registerDictionary';
