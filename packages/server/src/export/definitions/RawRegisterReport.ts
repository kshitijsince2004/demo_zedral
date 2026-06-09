import type { AuthUser } from '../../services/authService';
import {
  countRawRegisterRows,
  fetchRawRegisterRows,
  iterateRawRegisterBatches,
  parseRawScope,
} from '../read/rawRegisterQuery';
import type { ExportFormat, ReportExecutionResult } from '../types';
import type { ReportDefinition } from './ReportDefinition';
import {
  dictionaryRows,
  projectRow,
  resolveColumns,
} from './registerDictionary';
import { ASYNC_ROW_THRESHOLD } from '../jobs/ExportJobService';

export const RawRegisterReport: ReportDefinition = {
  id: 'RAW',

  validateScope(scope: Record<string, unknown>) {
    const parsed = parseRawScope(scope);
    if (parsed.dateFrom && parsed.dateTo && parsed.dateTo < parsed.dateFrom) {
      throw new Error('dateTo must be on or after dateFrom');
    }
  },

  supportedFormats(): ExportFormat[] {
    return ['CSV', 'XLSX'];
  },

  async estimateRowCount(scope: Record<string, unknown>, user: AuthUser): Promise<number> {
    return countRawRegisterRows(scope, user);
  },

  async execute(
    scope: Record<string, unknown>,
    format: ExportFormat,
    user: AuthUser,
  ): Promise<ReportExecutionResult> {
    if (!this.supportedFormats().includes(format)) {
      throw new Error(`Format ${format} not supported for RAW export`);
    }

    const columns = resolveColumns(parseRawScope(scope).columns);
    const rowCount = await countRawRegisterRows(scope, user);
    const useStreaming = format === 'CSV' && rowCount > 0;

    if (format === 'XLSX' && rowCount > ASYNC_ROW_THRESHOLD) {
      throw new Error(
        `RAW XLSX export exceeds ${ASYNC_ROW_THRESHOLD} rows — use CSV or narrow filters (async worker: Phase 7)`,
      );
    }

    const label = parseRawScope(scope).processCodes?.join('-')
      ?? parseRawScope(scope).processId
      ?? 'MULTI';
    const ext = format === 'XLSX' ? 'xlsx' : 'csv';
    const today = new Date().toISOString().slice(0, 10);

    if (useStreaming) {
      return {
        rows: [],
        filename: `raw_export_${label}_${today}.${ext}`,
        dataVersion: `RAW:${label}:${rowCount}`,
        streamBatches: async function* () {
          for await (const batch of iterateRawRegisterBatches(scope, user)) {
            yield batch.map((r) => projectRow(r, columns));
          }
        },
        columns,
        rowCount,
        deterministic: true,
      };
    }

    const { rows, lines } = await fetchRawRegisterRows(scope, user);
    const projected = rows.map((r) => projectRow(r, columns));

    const result: ReportExecutionResult = {
      rows: projected,
      filename: `raw_export_${label}_${today}.${ext}`,
      dataVersion: `RAW:${lines.join(',')}:${projected.length}`,
      columns,
      rowCount: projected.length,
      deterministic: true,
    };

    if (format === 'XLSX') {
      result.sheets = [
        { name: 'data', rows: projected },
        { name: 'data_dictionary', rows: dictionaryRows() },
      ];
    }

    return result;
  },
};

export { fetchRawRegisterRows } from '../read/rawRegisterQuery';
