import { sql } from 'kysely';
import { db } from '../../db';
import type { AuthUser } from '../../services/authService';
import { ReportingService } from '../../services/ReportingService';
import { SixHiService } from '../../services/SixHiService';
import type { ExportFormat, ReportExecutionResult } from '../types';
import type { ReportDefinition } from './ReportDefinition';
import { currentPlantDate } from '../../utils/dateOnly';

interface ShiftSummaryScope {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  shiftCode?: string;
  machineCodes?: string[];
}

function parseScope(scope: Record<string, unknown>): ShiftSummaryScope {
  const date = scope.date ?? scope.shiftDate ?? scope.shift_date;
  const dateFrom = scope.dateFrom ?? scope.date_from ?? date;
  const dateTo = scope.dateTo ?? scope.date_to ?? dateFrom;
  const shiftRaw = scope.shiftCode ?? scope.shift ?? scope.shift_code;
  let machineCodes: string[] | undefined;
  const machines = scope.machineCodes ?? scope.machine_codes ?? scope.machines ?? scope.machine;
  if (Array.isArray(machines)) {
    machineCodes = machines.map(String);
  } else if (typeof machines === 'string' && machines.trim()) {
    machineCodes = machines.split(',').map((s) => s.trim()).filter(Boolean);
  }

  return {
    date: date ? String(date).slice(0, 10) : undefined,
    dateFrom: dateFrom ? String(dateFrom).slice(0, 10) : undefined,
    dateTo: dateTo ? String(dateTo).slice(0, 10) : undefined,
    shiftCode: shiftRaw ? String(shiftRaw).toUpperCase() : undefined,
    machineCodes,
  };
}

function applyMachineScope(user: AuthUser, machineCodes?: string[]): string[] | undefined {
  const isMachineHead = user.roles.includes('MACHINE_HEAD');
  if (!isMachineHead) return machineCodes;

  const allowed = (user.machineAccess ?? []).map((m) => m.toUpperCase());
  if (allowed.length === 0) return [];
  if (!machineCodes?.length) return allowed;
  return machineCodes.map((m) => m.toUpperCase()).filter((m) => allowed.includes(m));
}

function buildHtml(title: string, summaryRows: Record<string, unknown>[], orderRows: Record<string, unknown>[]): string {
  const summaryTable = summaryRows.map((r) =>
    `<tr>${Object.values(r).map((v) => `<td>${String(v ?? '')}</td>`).join('')}</tr>`,
  ).join('');
  const orderTable = orderRows.map((r) =>
    `<tr>${Object.values(r).map((v) => `<td>${String(v ?? '')}</td>`).join('')}</tr>`,
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;font-size:12px}table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}h2{margin-top:24px}</style></head><body>
<h1>${title}</h1>
<h2>Summary</h2><table><tbody>${summaryTable}</tbody></table>
<h2>Orders</h2><table><tbody>${orderTable}</tbody></table>
</body></html>`;
}

export const ShiftSummaryReport: ReportDefinition = {
  id: 'SHIFT_SUMMARY',

  validateScope(scope: Record<string, unknown>) {
    const parsed = parseScope(scope);
    if (!parsed.dateFrom) throw new Error('date is required');
    if (!parsed.shiftCode) throw new Error('shiftCode is required');
  },

  supportedFormats(): ExportFormat[] {
    return ['CSV', 'XLSX', 'PDF'];
  },

  async estimateRowCount(scope: Record<string, unknown>, _user: AuthUser): Promise<number> {
    const parsed = parseScope(scope);
    if (!parsed.dateFrom || !parsed.shiftCode) return 0;
    const shiftLogId = await SixHiService.resolveShiftLogIdForPlan(parsed.dateFrom, parsed.shiftCode);
    if (!shiftLogId) return 0;
    const review = await ReportingService.getShiftReview(shiftLogId);
    if (!review) return 0;
    return (review.completedOrders?.length ?? 0) + (review.ordersInProgress?.length ?? 0) + 5;
  },

  async execute(
    scope: Record<string, unknown>,
    format: ExportFormat,
    user: AuthUser,
  ): Promise<ReportExecutionResult> {
    if (!this.supportedFormats().includes(format)) {
      throw new Error(`Format ${format} not supported for SHIFT_SUMMARY export`);
    }

    const parsed = parseScope(scope);
    if (!parsed.dateFrom) throw new Error('date is required');
    if (!parsed.shiftCode) throw new Error('shiftCode is required');

    const machineCodes = applyMachineScope(user, parsed.machineCodes);
    if (machineCodes && machineCodes.length === 0) {
      throw new Error('No machine access for shift summary export');
    }

    const machineFilter = machineCodes?.length === 1 ? machineCodes[0] : machineCodes;
    const shiftLogId = await SixHiService.resolveShiftLogIdForPlan(parsed.dateFrom, parsed.shiftCode);
    if (!shiftLogId) {
      throw new Error(`No shift log found for ${parsed.dateFrom} shift ${parsed.shiftCode}`);
    }

    const [review, handover] = await Promise.all([
      ReportingService.getShiftReview(shiftLogId),
      ReportingService.getMachineHandoverSummary(shiftLogId).catch(() => null),
    ]);
    if (!review) throw new Error('Shift review data not available');

    const heldOrders = await db.selectFrom('txn.crm_order as o')
      .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
      .leftJoin('txn.order_rejection as rej', 'rej.order_id', 'o.order_id')
      .select([
        'pb.batch_number as Batch Number',
        'pb.customer_name as Customer',
        'pb.machine_code as Machine',
        'o.sub_process as Process',
        'pb.ppc_weight_mt as Weight (MT)',
        sql<string>`COALESCE(rej.rejection_reason, '')`.as('Hold Reason'),
      ])
      .where('o.shift_log_id', '=', shiftLogId)
      .where('o.status', '=', 'REJECTED')
      .$if(Boolean(machineFilter), (qb) => {
        if (Array.isArray(machineFilter)) return qb.where('pb.machine_code', 'in', machineFilter);
        if (typeof machineFilter === 'string') return qb.where('pb.machine_code', '=', machineFilter);
        return qb;
      })
      .execute();

    const filterByMachine = (machineCode?: string) => {
      if (!machineFilter) return true;
      if (!machineCode) return false;
      if (Array.isArray(machineFilter)) return machineFilter.includes(machineCode);
      return machineCode === machineFilter;
    };

    const completedOrders = (review.completedOrders ?? []).filter((o) =>
      filterByMachine((o as { machineCode?: string }).machineCode),
    );
    const inProgressOrders = (review.ordersInProgress ?? []).filter((o) =>
      filterByMachine(o.machineCode),
    );
    const stoppages = review.stoppages ?? [];

    const summaryRows = [
      { Metric: 'Production Date', Value: review.prodDate },
      { Metric: 'Shift', Value: review.shiftCode },
      { Metric: 'Process Line', Value: review.processLine ?? '—' },
      { Metric: 'Machines', Value: review.machines.join(', ') || '—' },
      { Metric: 'Target MT', Value: review.overview.targetMt },
      { Metric: 'Completed MT', Value: review.overview.completedProdMt },
      { Metric: 'Total MT', Value: review.overview.totalProdMt },
      { Metric: 'In Progress MT', Value: review.overview.inProgressProdMt },
      { Metric: 'Attainment %', Value: review.overview.attainmentPct },
      { Metric: 'Stoppage Minutes', Value: review.metrics.totalStoppageMinutes },
      { Metric: 'Breakdown Minutes', Value: review.metrics.totalBreakdownMinutes },
      { Metric: 'Utilization %', Value: review.metrics.machineUtilizationPct },
      { Metric: 'Produced MT (Handover)', Value: handover?.producedMt ?? '—' },
      { Metric: 'Open Coils', Value: handover?.openCoilCount ?? '—' },
      { Metric: 'Handover Notes', Value: handover?.notes ?? '—' },
    ];

    const completedRows = completedOrders.map((o) => ({
      'Batch Number': o.batchNumber,
      Status: 'COMPLETED',
      Customer: o.customer ?? '—',
      Process: o.subProcess ?? '—',
      'Weight (MT)': o.weightMt,
      'Duration (min)': o.durationMin ?? '—',
    }));

    const inProgressRows = inProgressOrders.map((o) => ({
      'Batch Number': o.batchNumber,
      Status: o.status,
      Process: o.subProcess ?? '—',
      Machine: o.machineCode ?? '—',
      'Weight (MT)': '—',
      'Duration (min)': '—',
    }));

    const heldRows = heldOrders.map((o) => ({
      'Batch Number': o['Batch Number'],
      Status: 'REJECTED',
      Customer: o.Customer ?? '—',
      Process: o.Process ?? '—',
      Machine: o.Machine ?? '—',
      'Hold Reason': o['Hold Reason'],
    }));

    const stoppageRows = stoppages.map((s) => ({
      Category: s.categoryLabel,
      'Batch Number': s.batchNumber,
      'Start At': s.startAt,
      'End At': s.endAt ?? 'Active',
      'Duration (min)': s.durationMin ?? '—',
      Remarks: s.remarks ?? '',
    }));

    const orderRows = [...completedRows, ...inProgressRows, ...heldRows];
    const today = currentPlantDate();
    const machineLabel = machineCodes?.join('-') ?? 'all';
    const ext = format === 'XLSX' ? 'xlsx' : format === 'PDF' ? 'pdf' : 'csv';
    const scopeLabel = `${parsed.dateFrom}_shift-${parsed.shiftCode}_${machineLabel}`;

    return {
      rows: summaryRows,
      filename: `shift_summary_${scopeLabel}_${today}.${ext}`,
      dataVersion: `SHIFT:${shiftLogId}:${orderRows.length}`,
      rowCount: summaryRows.length + orderRows.length,
      deterministic: true,
      sheets: [
        { name: 'Summary', rows: summaryRows },
        { name: 'Orders', rows: orderRows },
        { name: 'Stoppages', rows: stoppageRows },
        { name: 'Held Orders', rows: heldRows },
      ],
      html: buildHtml(`Shift Summary ${parsed.dateFrom} · Shift ${parsed.shiftCode}`, summaryRows, orderRows),
    };
  },
};
