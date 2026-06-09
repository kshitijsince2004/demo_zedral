import type { AuthUser } from '../../services/authService';
import { bindCoilTraceWorkbook, coilTraceXlsxColumns } from '../layouts/CoilTraceBinder';
import { fetchCoilTraceBatch, parseCoilTraceScope } from '../read/coilTraceQuery';
import type { ExportFormat, ReportExecutionResult } from '../types';
import type { ReportDefinition } from './ReportDefinition';

export const CoilTraceReport: ReportDefinition = {
  id: 'COIL_TRACE',

  validateScope(scope: Record<string, unknown>) {
    parseCoilTraceScope(scope);
  },

  supportedFormats(): ExportFormat[] {
    return ['XLSX', 'PDF'];
  },

  async estimateRowCount(scope: Record<string, unknown>, user: AuthUser): Promise<number> {
    const traces = await fetchCoilTraceBatch(scope, user);
    return traces.reduce((n, t) => n + t.timeline.length, 0);
  },

  async execute(
    scope: Record<string, unknown>,
    format: ExportFormat,
    user: AuthUser,
  ): Promise<ReportExecutionResult> {
    if (!this.supportedFormats().includes(format)) {
      throw new Error(`Format ${format} not supported for COIL_TRACE export`);
    }

    const parsed = parseCoilTraceScope(scope);
    const traces = await fetchCoilTraceBatch(scope, user);

    const generatedAt = new Date().toISOString();
    const bound = bindCoilTraceWorkbook(traces, generatedAt);

    const ext = format === 'PDF' ? 'pdf' : 'xlsx';
    let filename: string;
    if (parsed.mode === 'single') {
      filename = `coil_trace_${parsed.coilNo}.${ext}`;
    } else {
      filename = `coil_trace_${parsed.customerCode}_${parsed.dateFrom}_${parsed.dateTo}.${ext}`;
    }

    return {
      rows: bound.rows,
      columns: coilTraceXlsxColumns(),
      filename,
      sheets: [{ name: 'CoilTrace', rows: bound.rows }],
      html: bound.html,
      dataVersion: `COIL_TRACE:${traces.length}:${bound.rows.length}`,
      sourceRecordCount: bound.rows.length,
      rowCount: bound.rows.length,
      deterministic: format === 'XLSX',
    };
  },
};
