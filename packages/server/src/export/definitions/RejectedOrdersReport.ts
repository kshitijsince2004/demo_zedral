import { sql } from 'kysely';
import { db } from '../../db';
import type { AuthUser } from '../../services/authService';
import type { ExportFormat, ReportExecutionResult } from '../types';
import type { ReportDefinition } from './ReportDefinition';
import { currentPlantDate, formatPlantDate, formatPlantDateTime, postgresDateOnly } from '../../utils/dateOnly';

interface RejectedOrdersScope {
  dateFrom?: string;
  dateTo?: string;
  shiftCode?: string;
  machineCodes?: string[];
}

function parseScope(scope: Record<string, unknown>): RejectedOrdersScope {
  const dateFrom = scope.dateFrom ?? scope.date_from;
  const dateTo = scope.dateTo ?? scope.date_to ?? dateFrom;
  const shiftRaw = scope.shiftCode ?? scope.shift ?? scope.shift_code;
  let machineCodes: string[] | undefined;
  const machines = scope.machineCodes ?? scope.machine_codes ?? scope.machines;
  if (Array.isArray(machines)) {
    machineCodes = machines.map(String);
  } else if (typeof machines === 'string' && machines.trim()) {
    machineCodes = machines.split(',').map((s) => s.trim()).filter(Boolean);
  }

  return {
    dateFrom: dateFrom ? postgresDateOnly(String(dateFrom)) : undefined,
    dateTo: dateTo ? postgresDateOnly(String(dateTo)) : undefined,
    shiftCode: shiftRaw ? String(shiftRaw) : undefined,
    machineCodes,
  };
}

export const RejectedOrdersReport: ReportDefinition = {
  id: 'REJECTED_ORDERS',

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
    let q = db.selectFrom('txn.crm_order as o')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('o.status', '=', 'REJECTED');

    if (parsed.dateFrom) {
      q = q.where(sql`date(o.prod_end_at)`, '>=', parsed.dateFrom);
    }
    if (parsed.dateTo) {
      q = q.where(sql`date(o.prod_end_at)`, '<=', parsed.dateTo);
    }

    const res = await q.executeTakeFirst();
    return res?.n ?? 0;
  },

  async execute(
    scope: Record<string, unknown>,
    format: ExportFormat,
    _user: AuthUser,
  ): Promise<ReportExecutionResult> {
    if (!this.supportedFormats().includes(format)) {
      throw new Error(`Format ${format} not supported for REJECTED_ORDERS export`);
    }

    const parsed = parseScope(scope);

    let rowsQuery = db.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .leftJoin('txn.order_rejection as rej', 'rej.order_id', 'o.order_id')
      .leftJoin('security.app_user as u', 'u.user_id', 'rej.operator_id')
      .select([
        'pb.batch_number as Batch Number',
        sql<string>`CASE WHEN pb.slit_id IS NOT NULL AND trim(pb.slit_id) <> '' THEN trim(pb.coil_no) || ' ' || trim(pb.slit_id) ELSE trim(pb.coil_no) END`.as('Mother Coil'),
        'pb.customer_name as Customer',
        'pb.grade_code as Grade',
        'pb.machine_code as Machine',
        'pb.shift_code as Shift',
        'pb.plan_date as Production Date',
        'o.sub_process as Process',
        'o.prod_end_at as Hold Time',
        sql<string>`COALESCE(rej.rejection_reason, 'No reason provided')`.as('Hold Reason'),
        sql<string>`COALESCE(rej.remarks, '')`.as('Hold Remarks'),
        sql<string>`COALESCE(u.full_name, 'Unknown')`.as('Held By'),
        'pb.ppc_weight_mt as PPC Weight (MT)',
      ])
      .where('o.status', '=', 'REJECTED')
      .orderBy('o.prod_end_at', 'desc');

    if (parsed.dateFrom) {
      rowsQuery = rowsQuery.where(sql`date(o.prod_end_at)`, '>=', parsed.dateFrom);
    }
    if (parsed.dateTo) {
      rowsQuery = rowsQuery.where(sql`date(o.prod_end_at)`, '<=', parsed.dateTo);
    }
    if (parsed.shiftCode) {
      rowsQuery = rowsQuery.where('pb.shift_code', '=', parsed.shiftCode);
    }
    if (parsed.machineCodes?.length) {
      rowsQuery = parsed.machineCodes.length === 1
        ? rowsQuery.where('pb.machine_code', '=', parsed.machineCodes[0])
        : rowsQuery.where('pb.machine_code', 'in', parsed.machineCodes);
    }

    const resultRows = await rowsQuery.execute();

    const today = currentPlantDate();
    const ext = format === 'XLSX' ? 'xlsx' : 'csv';
    const scopeLabel = [
      parsed.dateFrom ?? 'all-dates',
      parsed.shiftCode ? `shift-${parsed.shiftCode}` : 'all-shifts',
    ].join('_');
    const rows = resultRows.map((r) => ({
      ...r,
      'Hold Time': r['Hold Time']
        ? formatPlantDateTime(r['Hold Time'] as Date)
        : null,
      'Production Date': r['Production Date']
        ? formatPlantDate(r['Production Date'] as string | Date)
        : null,
    }));

    const result: ReportExecutionResult = {
      rows,
      filename: `order_hold_${scopeLabel}_${today}.${ext}`,
      dataVersion: `REJ:${rows.length}:${scopeLabel}`,
      rowCount: rows.length,
      deterministic: true,
    };

    if (format === 'XLSX') {
      result.sheets = [{ name: 'Order Hold', rows }];
    }

    return result;
  },
};
