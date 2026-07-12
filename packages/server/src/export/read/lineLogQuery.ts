import { db } from '../../db';
import type { AuthUser } from '../../services/authService';
import { getScopedLineCodes } from '../../auth/lineAccessPolicy';
import { dbProcessCode, loadLineLogLayout } from '../layouts/line_log';
import type { LineLogRdm, LineLogShiftBundle } from '../layouts/line_log/types';
import { ExportReadRepository } from './ExportReadRepository';
import type { ProcessRunRow } from './types';

export interface LineLogScope {
  processCode: string;
  dateFrom: string;
  dateTo: string;
  shiftCode?: string;
}

export function parseLineLogScope(scope: Record<string, unknown>): LineLogScope {
  const processCode = String(scope.process_code ?? scope.processCode ?? '').toUpperCase();
  const dateFrom = String(scope.date_from ?? scope.dateFrom ?? '');
  const dateTo = String(scope.date_to ?? scope.dateTo ?? '');
  const shiftCode = scope.shift ?? scope.shiftCode;

  if (!processCode) throw new Error('process_code is required');
  if (!dateFrom || !dateTo) throw new Error('date_from and date_to are required');
  if (dateTo < dateFrom) throw new Error('date_to must be on or after date_from');

  return {
    processCode,
    dateFrom,
    dateTo,
    shiftCode: shiftCode ? String(shiftCode) : undefined,
  };
}

function runToBodyRow(run: ProcessRunRow): Record<string, string | number | null> {
  const attrs = run.attrs ?? {};
  return {
    coil_no: run.coilNo,
    prod_date: run.prodDate,
    shift_code: run.shiftCode,
    weight_mt: run.outputWeightMt,
    output_wt_mt: run.outputWeightMt,
    thk_mm: run.outputThkMm,
    output_thk_mm: run.outputThkMm,
    nominal_thk_mm: run.outputThkMm,
    time_from: run.timeFrom,
    time_to: run.timeTo,
    status: run.status,
    sub_process: attrs.sub_process as string | null ?? null,
    input_thk_mm: attrs.input_thk_mm as number | null ?? null,
    charge_no: attrs.charge_no as string | null ?? null,
    loading_mt: attrs.loading_mt as number | null ?? null,
    unloading_mt: attrs.unloading_mt as number | null ?? null,
    temperature_degc: attrs.temperature_degc as number | null ?? null,
    surface_finish: attrs.surface_finish as string | null ?? null,
    wt_scrap_mt: attrs.wt_scrap_mt as number | null ?? null,
    width_mm: attrs.width_mm as number | null ?? null,
    scrap_mt: attrs.scrap_mt as number | null ?? null,
    slit_no: attrs.slit_no as string | null ?? null,
    for_ctl_mt: attrs.for_ctl_mt as number | null ?? null,
    no_bundles: attrs.no_bundles as number | null ?? null,
    no_pieces: attrs.no_pieces as number | null ?? null,
    total_passes: attrs.total_passes as number | null ?? null,
    sl_no: null,
    line_speed_mpm: null,
    actual_length_mm: null,
    hardness_hrb: attrs.hardness_hrb as number | null ?? null,
  };
}

export async function fetchLineLogRdm(
  scope: Record<string, unknown>,
  user: AuthUser,
): Promise<LineLogRdm> {
  const parsed = parseLineLogScope(scope);
  const layout = loadLineLogLayout(parsed.processCode);
  const dbCode = dbProcessCode(parsed.processCode);

  const scoped = getScopedLineCodes(user, 'READ');
  if (scoped !== null && !scoped.includes(dbCode) && !scoped.includes(parsed.processCode)) {
    throw new Error(`No read access to line ${parsed.processCode}`);
  }

  const runs = await ExportReadRepository.fetchRuns({
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
    processCode: dbCode,
    shiftCode: parsed.shiftCode,
  });

  const shiftLogs = await db
    .selectFrom('txn.shift_log as sl')
    .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
    .select(['sl.shift_log_id', 'sl.prod_date', 'sl.shift_code'])
    .where('p.code', '=', dbCode)
    .where('sl.prod_date', '>=', new Date(parsed.dateFrom))
    .where('sl.prod_date', '<=', new Date(parsed.dateTo))
    .$if(!!parsed.shiftCode, (q) => q.where('sl.shift_code', '=', parsed.shiftCode!))
    .execute();

  const shifts: LineLogShiftBundle[] = [];

  for (const sl of shiftLogs) {
    const sid = String(sl.shift_log_id);
    const prodDate = String(sl.prod_date).slice(0, 10);
    const bodyRows = runs
      .filter((r) => r.prodDate === prodDate && r.shiftCode === sl.shift_code)
      .map(runToBodyRow);

    const stoppages = dbCode === '6HI'
      ? await fetchCrm6Stoppages(sid)
      : await fetchShiftStoppages(sid);

    const crew = await db
      .selectFrom('txn.session_crew as sc')
      .innerJoin('txn.machine_shift_session as mss', 'mss.session_id', 'sc.session_id')
      .innerJoin('master.machine_crew_roster as mcr', 'mcr.crew_id', 'sc.crew_id')
      .select(['mcr.member_name as operator_name', 'mcr.role_label as role_code'])
      .where('mss.shift_log_id', '=', sid)
      .execute();

    const coilNos = bodyRows.map((r) => r.coil_no).filter(Boolean) as string[];
    let defects: Record<string, unknown>[] = [];
    if (coilNos.length > 0) {
      const proc = await db
        .selectFrom('master.process')
        .select('process_id')
        .where('code', '=', dbCode)
        .executeTakeFirst();
      if (proc) {
        defects = await db
          .selectFrom('txn.defect_entry as de')
          .innerJoin('master.defect_code as dc', 'de.defect_code', 'dc.defect_code')
          .select(['de.coil_no', 'de.defect_code', 'dc.description as defect_label', 'de.qty_mt', 'de.location'])
          .where('de.process_id', '=', proc.process_id)
          .where('de.coil_no', 'in', coilNos)
          .execute() as Record<string, unknown>[];
      }
    }

    shifts.push({
      shiftLogId: sid,
      prodDate,
      shiftCode: sl.shift_code,
      bodyRows,
      stoppages,
      crew: crew as Record<string, unknown>[],
      defects,
    });
  }

  return {
    report: 'LINE_LOG',
    processCode: parsed.processCode,
    documentNumber: layout.documentNumber,
    title: layout.title,
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
    shiftCode: parsed.shiftCode,
    shifts,
    generatedAt: new Date().toISOString(),
  };
}

async function fetchShiftStoppages(shiftLogId: string) {
  return db
    .selectFrom('txn.stoppage as se')
    .innerJoin('master.stoppage_code as sc', 'se.breakdown_code', 'sc.stoppage_code')
    .select([
      'se.breakdown_code as stoppage_code',
      'se.start_at as time_from',
      'se.end_at as time_to',
      'se.duration_min',
      'se.remarks',
      'sc.description',
    ])
    .where('se.shift_log_id', '=', shiftLogId)
    .execute();
}

async function fetchCrm6Stoppages(shiftLogId: string) {
  return db
    .selectFrom('txn.stoppage as os')
    .innerJoin('txn.crm_order as o', 'os.order_id', 'o.order_id')
    .leftJoin('master.stoppage_category as sc', 'os.category_code', 'sc.category_code')
    .select([
      'os.category_code',
      'os.breakdown_code',
      'os.duration_min',
      'os.remarks',
      'sc.label as category_label',
    ])
    .where('o.shift_log_id', '=', shiftLogId)
    .execute();
}
