import { sql } from 'kysely';
import { db } from '../../db';
import type { AuthUser } from '../../services/authService';
import type { ExportFormat, ReportExecutionResult } from '../types';
import type { ReportDefinition } from './ReportDefinition';
import { currentPlantDate } from '../../utils/dateOnly';

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
    dateFrom: dateFrom ? String(dateFrom).slice(0, 10) : undefined,
    dateTo: dateTo ? String(dateTo).slice(0, 10) : undefined,
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
    let q = db.selectFrom('txn.crm6_order as o')
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

    let rowsQuery = db.selectFrom('txn.crm6_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .leftJoin('txn.order_rejection as rej', 'rej.order_id', 'o.order_id')
      .leftJoin('security.app_user as u', 'u.user_id', 'rej.operator_id')
      .select([
        'pb.batch_number as Batch Number',
        'pb.coil_no as Mother Coil',
        'pb.slit_id as Slit ID',
        'pb.customer_name as Customer',
        'pb.grade_code as Grade',
        'pb.machine_code as Machine',
        'pb.shift_code as Shift',
        'pb.plan_date as Production Date',
        'o.sub_process as Process',
        'o.prod_end_at as Rejection Time',
        sql<string>`COALESCE(rej.rejection_reason, 'No reason provided')`.as('Rejection Reason'),
        sql<string>`COALESCE(rej.remarks, '')`.as('Rejection Remarks'),
        sql<string>`COALESCE(u.full_name, 'Unknown')`.as('Rejected By'),
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
      'Rejection Time': r['Rejection Time']
        ? new Date(r['Rejection Time'] as Date).toISOString()
        : null,
      'Production Date': r['Production Date']
        ? String(r['Production Date']).slice(0, 10)
        : null,
    }));

    const result: ReportExecutionResult = {
      rows,
      filename: `rejected_orders_${scopeLabel}_${today}.${ext}`,
      dataVersion: `REJ:${rows.length}:${scopeLabel}`,
      rowCount: rows.length,
      deterministic: true,
    };

    if (format === 'XLSX') {
      result.sheets = [{ name: 'Rejected Orders', rows }];
    }

    return result;
  },
};
