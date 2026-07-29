import { sql } from 'kysely';
import { db } from '../../db';
import type { AuthUser } from '../../services/authService';
import type { ExportFormat, ReportExecutionResult } from '../types';
import type { ReportDefinition } from './ReportDefinition';
import { currentPlantDate } from '../../utils/dateOnly';

interface Scope {
  dateFrom?: string;
  dateTo?: string;
  processCode?: string;
}

function parseScope(scope: Record<string, unknown>): Scope {
  const dateFrom = scope.dateFrom ?? scope.date_from;
  const dateTo = scope.dateTo ?? scope.date_to ?? dateFrom;
  const processRaw = scope.processCode ?? scope.process ?? scope.process_code;
  return {
    dateFrom: dateFrom ? String(dateFrom).slice(0, 10) : undefined,
    dateTo: dateTo ? String(dateTo).slice(0, 10) : undefined,
    processCode: processRaw ? String(processRaw).toUpperCase() : undefined,
  };
}

export const QcFailsReport: ReportDefinition = {
  id: 'QC_FAILS',

  validateScope(scope: Record<string, unknown>) {
    const parsed = parseScope(scope);
    if (parsed.dateFrom && parsed.dateTo && parsed.dateTo < parsed.dateFrom) {
      throw new Error('dateTo must be on or after dateFrom');
    }
  },

  supportedFormats(): ExportFormat[] {
    return ['CSV', 'XLSX'];
  },

  async estimateRowCount(scope: Record<string, unknown>, _user: AuthUser): Promise<number> {
    const parsed = parseScope(scope);
    let q = (db as any)
      .selectFrom('txn.qc_measurement')
      .select((eb: any) => eb.fn.countAll().as('n'))
      .where('verdict', '=', 'FAIL');
    if (parsed.dateFrom) q = q.where(sql`date(measured_at)`, '>=', parsed.dateFrom);
    if (parsed.dateTo) q = q.where(sql`date(measured_at)`, '<=', parsed.dateTo);
    if (parsed.processCode) q = q.where('process_code', '=', parsed.processCode);
    const res = await q.executeTakeFirst();
    return Number(res?.n ?? 0);
  },

  async execute(
    scope: Record<string, unknown>,
    format: ExportFormat,
    _user: AuthUser,
  ): Promise<ReportExecutionResult> {
    if (!this.supportedFormats().includes(format)) {
      throw new Error(`Format ${format} not supported for QC_FAILS export`);
    }
    const parsed = parseScope(scope);
    let q = (db as any)
      .selectFrom('txn.qc_measurement as q')
      .leftJoin('master.spec_parameter as p', 'p.parameter_code', 'q.parameter_code')
      .select([
        'q.measured_at as Measured At',
        'q.coil_no as Coil',
        'q.process_code as Process',
        'q.parameter_code as Parameter Code',
        'p.label as Parameter',
        'q.measured_value_num as Measured Value',
        'q.measured_value_text as Measured Text',
        'q.version_id as Spec Version Id',
        'q.verdict as Verdict',
        'q.measured_by as Measured By',
      ])
      .where('q.verdict', '=', 'FAIL')
      .orderBy('q.measured_at', 'desc')
      .limit(5000);
    if (parsed.dateFrom) q = q.where(sql`date(q.measured_at)`, '>=', parsed.dateFrom);
    if (parsed.dateTo) q = q.where(sql`date(q.measured_at)`, '<=', parsed.dateTo);
    if (parsed.processCode) q = q.where('q.process_code', '=', parsed.processCode);

    const resultRows = await q.execute();
    const today = currentPlantDate();
    const rows = resultRows.map((r: any) => ({
      ...r,
      'Measured At': r['Measured At'] ? new Date(r['Measured At']).toISOString() : null,
    }));
    const scopeLabel = [parsed.dateFrom ?? 'all-dates', parsed.processCode ?? 'all-processes'].join('_');
    const result: ReportExecutionResult = {
      rows,
      filename: `qc_fails_${scopeLabel}_${today}.${format === 'XLSX' ? 'xlsx' : 'csv'}`,
      dataVersion: `QCFAIL:${rows.length}:${scopeLabel}`,
      rowCount: rows.length,
      deterministic: true,
    };
    if (format === 'XLSX') result.sheets = [{ name: 'QC Fails', rows }];
    return result;
  },
};
