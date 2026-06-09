import type { AuthUser } from '../../services/authService';
import { bindLineLogWorkbook } from '../layouts/LineLogBinder';
import { loadLineLogLayout, normalizeProcessCode } from '../layouts/line_log';
import { fetchLineLogRdm, parseLineLogScope } from '../read/lineLogQuery';
import type { ExportFormat, ReportExecutionResult } from '../types';
import type { ReportDefinition } from './ReportDefinition';

export const LineLogReport: ReportDefinition = {
  id: 'LINE_LOG',

  validateScope(scope: Record<string, unknown>) {
    parseLineLogScope(scope);
    normalizeProcessCode(String(scope.process_code ?? scope.processCode));
  },

  supportedFormats(): ExportFormat[] {
    return ['XLSX', 'PDF'];
  },

  async estimateRowCount(scope: Record<string, unknown>, user: AuthUser): Promise<number> {
    const rdm = await fetchLineLogRdm(scope, user);
    return rdm.shifts.reduce((n, s) => n + s.bodyRows.length, 0);
  },

  async execute(
    scope: Record<string, unknown>,
    format: ExportFormat,
    user: AuthUser,
  ): Promise<ReportExecutionResult> {
    if (!this.supportedFormats().includes(format)) {
      throw new Error(`Format ${format} not supported for LINE_LOG export`);
    }

    const parsed = parseLineLogScope(scope);
    const layout = loadLineLogLayout(parsed.processCode);
    const rdm = await fetchLineLogRdm(scope, user);
    const bound = bindLineLogWorkbook(rdm);

    const filename = `line_log_${parsed.processCode}_${parsed.dateFrom}_${parsed.dateTo}.${format === 'PDF' ? 'pdf' : 'xlsx'}`;

    return {
      rows: bound.sheets.flatMap((s) => s.tableRows),
      filename,
      gridSheets: format === 'XLSX'
        ? bound.sheets.map((s) => ({ name: s.sheetName, cells: s.cells }))
        : undefined,
      sheets: bound.sheets.map((s) => ({ name: s.sheetName, rows: s.tableRows })),
      html: bound.html,
      dataVersion: `LINE_LOG:${parsed.processCode}:${layout.documentNumber}:${rdm.shifts.length}`,
      sourceRecordCount: rdm.shifts.reduce((n, s) => n + s.bodyRows.length, 0),
      rowCount: rdm.shifts.reduce((n, s) => n + s.bodyRows.length, 0),
      deterministic: format === 'XLSX',
    };
  },
};
