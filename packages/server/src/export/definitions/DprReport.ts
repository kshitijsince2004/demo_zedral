import type { AuthUser } from '../../services/authService';
import { filterRunsByAreaAccess, getScopedDprAreaCodes } from '../auth/exportAuthz';
import { DprAggregator } from '../aggregation/DprAggregator';
import { bindDprWorkbook, dprFilename, loadDprLayout } from '../layouts/TemplateBinder';
import { injectDprTemplate } from '../dpr/DprTemplateInjector';
import {
  ExportReadRepository,
  scopeFromMonth,
} from '../read/ExportReadRepository';
import type { ExportFormat, ReportExecutionResult } from '../types';
import type { ReportDefinition } from './ReportDefinition';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseMonth(scope: Record<string, unknown>): string {
  const month = scope.month ? String(scope.month) : '';
  if (!MONTH_RE.test(month)) {
    throw new Error('scope.month is required (format YYYY-MM, e.g. 2026-05)');
  }
  return month;
}

async function loadMonthData(month: string, user: AuthUser) {
  const scope = scopeFromMonth(month);
  const [runs, stoppages, dispositions, targets] = await Promise.all([
    ExportReadRepository.fetchRuns(scope),
    ExportReadRepository.fetchStoppages(scope),
    ExportReadRepository.fetchDisposition(scope),
    ExportReadRepository.fetchTargets(month),
  ]);
  return {
    month,
    runs: filterRunsByAreaAccess(user, runs),
    stoppages: filterRunsByAreaAccess(user, stoppages),
    dispositions: filterRunsByAreaAccess(user, dispositions),
    targets,
  };
}

export const DprReport: ReportDefinition = {
  id: 'DPR',

  validateScope(scope: Record<string, unknown>) {
    parseMonth(scope);
  },

  supportedFormats(): ExportFormat[] {
    return ['XLSX'];
  },

  async estimateRowCount(scope: Record<string, unknown>, _user: AuthUser): Promise<number> {
    const month = parseMonth(scope);
    const [, m] = month.split('-').map(Number);
    const days = new Date(Number(month.split('-')[0]), m, 0).getDate();
    return days * 24;
  },

  async execute(
    scope: Record<string, unknown>,
    format: ExportFormat,
    user: AuthUser,
  ): Promise<ReportExecutionResult> {
    if (format !== 'XLSX') {
      throw new Error(`Format ${format} not supported for DPR export`);
    }

    const month = parseMonth(scope);
    const input = await loadMonthData(month, user);
    const rdm = DprAggregator.aggregate(input);
    const sourceRecordCount = input.runs.length + input.stoppages.length + input.dispositions.length;
    const scopedAreas = getScopedDprAreaCodes(user);

    try {
      const injected = await injectDprTemplate(rdm, {
        allowedAreaCodes: scopedAreas,
      });
      return {
        rows: rdm.delayLog.map((e) => ({ ...e })),
        filename: injected.filename,
        templateBuffer: injected.buffer,
        dataVersion: `DPR:${month}:${rdm.days.length}:${rdm.delayLog.length}:template`,
        sourceRecordCount,
        deterministic: true,
      };
    } catch {
      const layout = loadDprLayout();
      const bound = bindDprWorkbook(rdm, layout);
      return {
        rows: bound.delayRows,
        filename: dprFilename(month),
        sheets: [{ name: bound.delaySheetName, rows: bound.delayRows }],
        gridSheets: [
          { name: bound.monthSheetName, cells: bound.monthCells },
          { name: bound.delaySheetName, cells: bound.delayCells },
        ],
        dataVersion: `DPR:${month}:${rdm.days.length}:${rdm.delayLog.length}`,
        sourceRecordCount,
        deterministic: true,
      };
    }
  },
};

/** Test helper — aggregate + bind without DB reads. */
export function buildDprFromFixture(input: Parameters<typeof DprAggregator.aggregate>[0]) {
  const rdm = DprAggregator.aggregate(input);
  const bound = bindDprWorkbook(rdm);
  return { rdm, bound };
}
