import type { CoilTraceRdm } from '../types/rdm';

export interface CoilTraceXlsxRow {
  coil_no: string;
  seq: number;
  process: string;
  prod_date: string;
  shift_code: string;
  operator: string | null;
  status: string;
  grade: string | null;
  customer: string | null;
  source_coil_no: string | null;
  for_ctl_flag: boolean;
  charge_no: string | null;
  base_no: string | null;
  weight_mt: unknown;
  thk_mm: unknown;
  width_mm: unknown;
  defects: string;
  [key: string]: unknown;
}

export interface BoundCoilTraceWorkbook {
  rows: CoilTraceXlsxRow[];
  html: string;
}

const XLSX_COLUMNS: Array<keyof CoilTraceXlsxRow | string> = [
  'coil_no',
  'seq',
  'process',
  'prod_date',
  'shift_code',
  'operator',
  'status',
  'grade',
  'customer',
  'source_coil_no',
  'for_ctl_flag',
  'charge_no',
  'base_no',
  'weight_mt',
  'thk_mm',
  'width_mm',
  'defects',
];

export function bindCoilTraceWorkbook(
  traces: CoilTraceRdm[],
  generatedAt: string,
): BoundCoilTraceWorkbook {
  const rows: CoilTraceXlsxRow[] = [];

  for (const trace of traces) {
    for (const step of trace.timeline) {
      rows.push({
        coil_no: trace.coilNo,
        seq: step.seq,
        process: step.process,
        prod_date: step.date,
        shift_code: step.shift,
        operator: step.operator,
        status: step.status,
        grade: trace.header.grade,
        customer: trace.header.customer,
        source_coil_no: trace.header.sourceCoilNo,
        for_ctl_flag: trace.header.forCtlFlag || Boolean(step.keyValues.for_ctl_flag),
        charge_no: step.chargeNo ?? null,
        base_no: step.baseNo ?? null,
        weight_mt: step.keyValues.weight_mt ?? null,
        thk_mm: step.keyValues.thk_mm ?? null,
        width_mm: step.keyValues.width_mm ?? null,
        defects: step.quality.defects.join('; '),
      });
    }
  }

  return { rows, html: buildCoilTraceHtml(traces, generatedAt) };
}

export function coilTraceXlsxColumns(): string[] {
  return XLSX_COLUMNS.map(String);
}

function buildCoilTraceHtml(traces: CoilTraceRdm[], generatedAt: string): string {
  const watermark = `Generated from M1 on ${generatedAt}`;
  const pages = traces.map((trace) => {
    const forCtlBadge = trace.header.forCtlFlag
      ? '<span class="badge ctl">FOR CTL ROUTING</span>'
      : '';

    const rows = trace.timeline.map((step) => {
      const annExtra = step.chargeNo
        ? `<br/><em>Charge: ${step.chargeNo}${step.baseNo ? ` · Base: ${step.baseNo}` : ''}</em>`
        : '';
      const ctlFlag = step.keyValues.for_ctl_flag
        ? ' <span class="badge ctl-sm">FOR CTL</span>'
        : '';
      const defects = step.quality.defects.length
        ? step.quality.defects.join(', ')
        : '—';

      return `<tr>
        <td>${step.seq}</td>
        <td>${step.process}${ctlFlag}</td>
        <td>${step.date}</td>
        <td>${step.shift}</td>
        <td>${step.operator ?? '—'}</td>
        <td>${step.status}</td>
        <td>${formatKeyValues(step.keyValues)}${annExtra}</td>
        <td>${defects}</td>
      </tr>`;
    }).join('');

    return `
      <section class="coil-page">
        <header>
          <h2>Coil Traceability Report</h2>
          <p class="coil-id"><strong>Coil:</strong> ${trace.coilNo} ${forCtlBadge}</p>
          <p class="meta">
            <span><strong>Grade:</strong> ${trace.header.grade ?? '—'}</span>
            <span><strong>Customer:</strong> ${trace.header.customer ?? '—'}</span>
            <span><strong>Source coil:</strong> ${trace.header.sourceCoilNo ?? '—'}</span>
          </p>
        </header>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Process</th><th>Date</th><th>Shift</th>
              <th>Operator</th><th>Status</th><th>Key values</th><th>Defects</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8">No process steps recorded</td></tr>'}</tbody>
        </table>
      </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; color: #111; }
  .watermark { position: fixed; top: 42%; left: 8%; opacity: 0.1; font-size: 26px; transform: rotate(-28deg); z-index: 0; }
  h2 { margin: 0 0 8px; font-size: 16px; }
  .coil-id { font-size: 13px; margin: 0 0 6px; }
  .meta { display: flex; gap: 24px; flex-wrap: wrap; color: #444; margin-bottom: 14px; font-size: 11px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  th, td { border: 1px solid #333; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .coil-page { page-break-after: always; position: relative; z-index: 1; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; }
  .badge.ctl { background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; }
  .badge.ctl-sm { background: #fff7ed; color: #c2410c; font-size: 9px; padding: 1px 4px; }
</style></head><body>
  <div class="watermark">${watermark}</div>
  ${pages}
</body></html>`;
}

function formatKeyValues(kv: Record<string, unknown>): string {
  const parts: string[] = [];
  if (kv.weight_mt != null) parts.push(`Wt ${kv.weight_mt} MT`);
  if (kv.thk_mm != null) parts.push(`Thk ${kv.thk_mm} mm`);
  if (kv.width_mm != null) parts.push(`W ${kv.width_mm} mm`);
  if (kv.area_code) parts.push(String(kv.area_code));
  return parts.length ? parts.join(' · ') : '—';
}
