import { sql } from 'kysely';
import { db } from '../../db';
import { formatPlantTime } from '../../utils/dateOnly';
import { isBreakdownStoppageCategory } from '../../validation/manufacturingValidation';

export interface CoilDetailRow {
  orderId: string;
  sno: number;
  batchNumber: string;
  coilNo: string;
  status: string;
  customer: string;
  process: string;
  machine: string;
  gradeSurface: string;
  widthMm: number | null;
  incomingThkMm: number | null;
  weightMt: number | null;
  groupWeightMt: number | null;
  combinedGroupId?: string;
  combinedGroupTag: string;
  annHardRwTension: string;
  finishedThkMm: number | null;
  hardnessVpnHrb: string;
  btEcvMm: string;
  utsElong: string;
  loadStretch: string;
  pass1: number | null;
  pass2: number | null;
  pass3: number | null;
  pass4: number | null;
  pass5: number | null;
  pass6: number | null;
  finalThk: number | null;
  totalPasses: number | null;
  rwTension: string;
  rollFinish: string;
  rerolling: string;
  mi: string;
  defectCodes: string;
  timeFrom: string;
  timeTo: string;
  durationMin: number | null;
  remarks: string;
  rollIn: string;
  rollOut: string;
  isSkinPass: boolean;
  isRolling: boolean;
}

export interface HeldOrderRow {
  sno: number;
  coilNo: string;
  batchNumber: string;
  customer: string;
  machine: string;
  weightMt: number | null;
  heldBy: string;
  reasonDefect: string;
  timeHeld: string;
}

export interface StoppageRow {
  sno: number;
  from: string;
  to: string;
  totalMin: number | null;
  code: string;
  codeName: string;
  breakdownYn: string;
  reason: string;
}

export interface CodeRefRow {
  code: string;
  label: string;
  labelAlt?: string;
  symbol?: string;
  note?: string;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dash(v: unknown): string {
  if (v == null || v === '') return '';
  return String(v);
}

function fmtTime(v: Date | string | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return formatPlantTime(d);
}

function parseDefectCodes(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return raw ? [raw] : [];
    }
  }
  return [];
}

function joinRoll(code: string | null | undefined, no: string | null | undefined): string {
  const parts = [code, no].map((p) => (p == null || p === '' ? null : String(p))).filter(Boolean);
  return parts.join('/');
}

function machineFilterClause(
  machineFilter: string | string[] | undefined,
): { codes: string[] | null } {
  if (!machineFilter) return { codes: null };
  const codes = Array.isArray(machineFilter)
    ? machineFilter.map((m) => m.toUpperCase()).filter(Boolean)
    : [String(machineFilter).toUpperCase()];
  return { codes: codes.length ? codes : null };
}

export async function loadCoilDetails(
  shiftLogId: string,
  machineFilter?: string | string[],
): Promise<CoilDetailRow[]> {
  const { codes } = machineFilterClause(machineFilter);

  let query = db
    .selectFrom('txn.crm_order as o')
    .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
    .leftJoin('txn.crm_rolling as r', 'r.order_id', 'o.order_id')
    .leftJoin('txn.crm_skinpass as sp', 'sp.order_id', 'o.order_id')
    .leftJoin('txn.order_rejection as rej', 'rej.order_id', 'o.order_id')
    .leftJoin('txn.prod_crs as crs', (join) =>
      join.onRef('crs.coil_no', '=', 'pb.coil_no').onRef('crs.shift_log_id', '=', 'o.shift_log_id'),
    )
    .select([
      'o.order_id',
      'o.batch_number',
      'o.status',
      'o.sub_process',
      'o.customer_name',
      'o.combined_group_id',
      'o.prod_start_at',
      'o.prod_end_at',
      'o.prod_duration_min',
      'o.ppc_weight_mt',
      'pb.coil_no',
      'pb.grade_code',
      'pb.roll_finish as batch_roll_finish',
      'pb.width_mm',
      'pb.input_thk_mm',
      'pb.machine_code',
      'pb.ppc_reroll_flag',
      'r.final_thk_mm',
      'r.total_passes',
      'r.rerolling',
      'r.roll_finish as rolling_roll_finish',
      'r.roll_in_code',
      'r.roll_in_no',
      'r.roll_out_code',
      'r.roll_out_no',
      'r.actual_weight_mt as rolling_wt',
      'sp.ann_hard',
      'sp.rw_tension_1',
      'sp.rw_tension_2',
      'sp.output_thk_mm',
      'sp.load_max_t',
      'sp.load_min_t',
      'sp.stretch_pct',
      'sp.actual_weight_mt as skinpass_wt',
      'rej.rejection_reason',
      'rej.remarks as rejection_remarks',
      'rej.defect_codes as rejection_defect_codes',
      'crs.hardness_vpn',
      'crs.hardness_hrb',
      'crs.ib_tiecv',
      'crs.uts_nmm2',
      'crs.elongation_pct',
    ])
    .where('o.shift_log_id', '=', shiftLogId)
    .where('o.status', '!=', 'CANCELLED')
    .orderBy(sql`o.combined_group_id NULLS LAST`)
    .orderBy('o.prod_start_at', 'asc')
    .orderBy('o.batch_number', 'asc')
    .orderBy('o.order_id', 'asc');

  if (codes?.length === 1) query = query.where('pb.machine_code', '=', codes[0]);
  else if (codes && codes.length > 1) query = query.where('pb.machine_code', 'in', codes);

  const rows = await query.execute();
  if (rows.length === 0) return [];

  const orderIds = rows.map((r) => String(r.order_id));
  const coilNos = [...new Set(rows.map((r) => r.coil_no).filter(Boolean))];

  const [passRows, defectRows] = await Promise.all([
    db
      .selectFrom('txn.crm_rolling_pass')
      .select(['order_id', 'pass_no', 'thickness_mm'])
      .where('order_id', 'in', orderIds)
      .orderBy('order_id', 'asc')
      .orderBy('pass_no', 'asc')
      .execute(),
    coilNos.length
      ? db
          .selectFrom('txn.defect_entry')
          .select(['coil_no', 'defect_code'])
          .where('coil_no', 'in', coilNos)
          .orderBy('coil_no', 'asc')
          .orderBy('defect_code', 'asc')
          .execute()
      : Promise.resolve([]),
  ]);

  const passesByOrder = new Map<string, Map<number, number>>();
  for (const p of passRows) {
    const oid = String(p.order_id);
    let m = passesByOrder.get(oid);
    if (!m) {
      m = new Map();
      passesByOrder.set(oid, m);
    }
    m.set(Number(p.pass_no), Number(p.thickness_mm));
  }

  const defectsByCoil = new Map<string, string[]>();
  for (const d of defectRows) {
    const coil = String(d.coil_no);
    const list = defectsByCoil.get(coil) ?? [];
    list.push(String(d.defect_code));
    defectsByCoil.set(coil, list);
  }

  return rows.map((r, i) => {
    const oid = String(r.order_id);
    const isSkinPass = String(r.sub_process).toUpperCase() === 'SKIN-PASS' || String(r.sub_process).toUpperCase() === 'SKINPASS';
    const isRolling = String(r.sub_process).toUpperCase() === 'ROLLING';
    const wt = num(isSkinPass ? r.skinpass_wt : r.rolling_wt) ?? num(r.ppc_weight_mt);
    const passes = passesByOrder.get(oid) ?? new Map();
    const grade = [r.grade_code, r.batch_roll_finish].filter(Boolean).join('/');
    const annParts = [
      r.ann_hard != null ? String(r.ann_hard) : null,
      r.rw_tension_1 != null || r.rw_tension_2 != null
        ? [r.rw_tension_1, r.rw_tension_2].filter((x) => x != null).join('/')
        : null,
    ].filter(Boolean);
    const loadStretch = [
      r.load_max_t != null || r.load_min_t != null
        ? [r.load_max_t, r.load_min_t].filter((x) => x != null).join('/')
        : null,
      r.stretch_pct != null ? String(r.stretch_pct) : null,
    ]
      .filter(Boolean)
      .join('/');
    const hardness =
      r.hardness_vpn != null || r.hardness_hrb != null
        ? [r.hardness_vpn, r.hardness_hrb].filter((x) => x != null).join('/')
        : '';
    const uts =
      r.uts_nmm2 != null || r.elongation_pct != null
        ? [r.uts_nmm2, r.elongation_pct].filter((x) => x != null).join('/')
        : '';
    const rejDefects = parseDefectCodes(r.rejection_defect_codes);
    const entryDefects = defectsByCoil.get(String(r.coil_no)) ?? [];
    const defectCodes = [...new Set([...rejDefects, ...entryDefects])].join(', ');
    const reroll = r.rerolling ?? r.ppc_reroll_flag;
    const finishedThk = num(isSkinPass ? r.output_thk_mm : r.final_thk_mm);
    const rwTension =
      r.rw_tension_1 != null || r.rw_tension_2 != null
        ? [r.rw_tension_1, r.rw_tension_2].filter((x) => x != null).join('/')
        : '';

    return {
      orderId: oid,
      sno: i + 1,
      batchNumber: dash(r.batch_number),
      coilNo: dash(r.coil_no),
      status: dash(r.status),
      customer: dash(r.customer_name),
      process: dash(r.sub_process),
      machine: dash(r.machine_code).toUpperCase(),
      gradeSurface: grade,
      widthMm: num(r.width_mm),
      incomingThkMm: num(r.input_thk_mm),
      weightMt: wt,
      groupWeightMt: null,
      combinedGroupId: r.combined_group_id ? String(r.combined_group_id) : undefined,
      combinedGroupTag: '',
      annHardRwTension: annParts.join(' / '),
      finishedThkMm: finishedThk,
      hardnessVpnHrb: hardness,
      btEcvMm: dash(r.ib_tiecv),
      utsElong: uts,
      loadStretch,
      pass1: passes.get(1) ?? null,
      pass2: passes.get(2) ?? null,
      pass3: passes.get(3) ?? null,
      pass4: passes.get(4) ?? null,
      pass5: passes.get(5) ?? null,
      pass6: passes.get(6) ?? null,
      finalThk: num(r.final_thk_mm),
      totalPasses: r.total_passes != null ? Number(r.total_passes) : null,
      rwTension,
      rollFinish: dash(r.rolling_roll_finish ?? r.batch_roll_finish),
      rerolling: reroll == null ? '' : reroll ? 'Y' : 'N',
      mi: '', // ponytail: no MI field in schema
      defectCodes,
      timeFrom: fmtTime(r.prod_start_at),
      timeTo: fmtTime(r.prod_end_at),
      durationMin: r.prod_duration_min != null ? Number(r.prod_duration_min) : null,
      remarks: dash(r.rejection_remarks ?? r.rejection_reason),
      rollIn: joinRoll(r.roll_in_code, r.roll_in_no),
      rollOut: joinRoll(r.roll_out_code, r.roll_out_no),
      isSkinPass,
      isRolling,
    };
  });
}

export async function loadHeldOrders(
  shiftLogId: string,
  machineFilter?: string | string[],
): Promise<HeldOrderRow[]> {
  const { codes } = machineFilterClause(machineFilter);

  let query = db
    .selectFrom('txn.crm_order as o')
    .innerJoin('planning.ppc_batch as pb', 'pb.batch_id', 'o.batch_id')
    .leftJoin('txn.order_rejection as rej', 'rej.order_id', 'o.order_id')
    .leftJoin('security.app_user as u', 'u.user_id', 'rej.operator_id')
    .select([
      'pb.coil_no',
      'pb.batch_number',
      'pb.customer_name',
      'pb.machine_code',
      'pb.ppc_weight_mt',
      'rej.rejection_reason',
      'rej.defect_codes',
      'rej.created_at',
      sql<string>`COALESCE(u.full_name, '')`.as('held_by'),
    ])
    .where('o.shift_log_id', '=', shiftLogId)
    .where('o.status', '=', 'REJECTED')
    .orderBy('rej.created_at', 'asc')
    .orderBy('pb.batch_number', 'asc');

  if (codes?.length === 1) query = query.where('pb.machine_code', '=', codes[0]);
  else if (codes && codes.length > 1) query = query.where('pb.machine_code', 'in', codes);

  const rows = await query.execute();
  return rows.map((r, i) => {
    const defects = parseDefectCodes(r.defect_codes);
    const reason = [r.rejection_reason, defects.join(', ')].filter(Boolean).join(' ');
    return {
      sno: i + 1,
      coilNo: dash(r.coil_no),
      batchNumber: dash(r.batch_number),
      customer: dash(r.customer_name),
      machine: dash(r.machine_code).toUpperCase(),
      weightMt: num(r.ppc_weight_mt),
      heldBy: dash(r.held_by),
      reasonDefect: reason,
      timeHeld: fmtTime(r.created_at),
    };
  });
}

export function mapStoppageRows(
  stoppages: Array<{
    id: string;
    categoryCode: string;
    categoryLabel: string;
    requiresBreakdownCode?: boolean;
    breakdownCode?: string;
    startAt: string;
    endAt?: string;
    durationMin?: number | null;
    remarks?: string;
  }>,
): StoppageRow[] {
  const sorted = [...stoppages].sort((a, b) => {
    const t = new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
  return sorted.map((s, i) => ({
    sno: i + 1,
    from: fmtTime(s.startAt),
    to: s.endAt ? fmtTime(s.endAt) : 'Active',
    totalMin: s.durationMin ?? null,
    code: dash(s.breakdownCode ?? s.categoryCode),
    codeName: dash(s.categoryLabel),
    breakdownYn: isBreakdownStoppageCategory(s.categoryCode, s.requiresBreakdownCode) ? 'Y' : 'N',
    reason: dash(s.remarks),
  }));
}

export async function loadStoppageCodeRefs(): Promise<CodeRefRow[]> {
  const rows = await db
    .selectFrom('master.stoppage_category')
    .select(['category_code', 'label'])
    .orderBy('category_code', 'asc')
    .execute();
  return rows.map((r) => ({
    code: String(r.category_code),
    label: String(r.label),
    labelAlt: String(r.label),
  }));
}

export async function loadDefectCodeRefs(): Promise<CodeRefRow[]> {
  const rows = await db
    .selectFrom('master.defect_code')
    .select(['defect_code', 'description', 'symbol'])
    .where('is_active', '=', true)
    .orderBy('defect_code', 'asc')
    .execute();
  return rows.map((r) => ({
    code: String(r.defect_code),
    label: String(r.description),
    symbol: r.symbol ? String(r.symbol) : undefined,
  }));
}

export async function loadShiftManagerName(shiftLogId: string): Promise<string> {
  const row = await db
    .selectFrom('txn.shift_log as sl')
    .leftJoin('master.operator as op', 'op.operator_id', 'sl.shift_manager_id')
    .select(['op.full_name'])
    .where('sl.shift_log_id', '=', shiftLogId)
    .executeTakeFirst();
  return dash(row?.full_name);
}

export async function loadShiftLogLeaders(shiftLogId: string): Promise<{
  lineIncharge: string;
  shiftManager: string;
  targetMt: number | null;
}> {
  const row = await db
    .selectFrom('txn.shift_log as sl')
    .leftJoin('master.operator as li', 'li.operator_id', 'sl.line_incharge_id')
    .leftJoin('master.operator as sm', 'sm.operator_id', 'sl.shift_manager_id')
    .select([
      'li.full_name as line_incharge',
      'sm.full_name as shift_manager',
      'sl.target_mt',
    ])
    .where('sl.shift_log_id', '=', shiftLogId)
    .executeTakeFirst();
  return {
    lineIncharge: dash(row?.line_incharge),
    shiftManager: dash(row?.shift_manager),
    targetMt: num(row?.target_mt),
  };
}

/** Completed coils only, grouped for combined runs with stable ordering. */
export function prepareCompletedCoilsForExport(coils: CoilDetailRow[]): CoilDetailRow[] {
  const completed = coils.filter((c) => c.status === 'COMPLETED');
  const keyed = completed.map((c) => ({
    ...c,
    _grp: c.combinedGroupId ?? `solo:${c.batchNumber}`,
  }));
  keyed.sort((a, b) =>
    a._grp === b._grp
      ? a.batchNumber.localeCompare(b.batchNumber)
      : a._grp.localeCompare(b._grp),
  );

  const groupCounts = new Map<string, number>();
  for (const c of keyed) {
    if (c.combinedGroupId) {
      groupCounts.set(c.combinedGroupId, (groupCounts.get(c.combinedGroupId) ?? 0) + 1);
    }
  }

  const tagByGroup = new Map<string, string>();
  let cgIndex = 0;
  const groupWeights = new Map<string, number>();
  for (const c of keyed) {
    if (!c.combinedGroupId || (groupCounts.get(c.combinedGroupId) ?? 0) < 2) continue;
    const sum = keyed
      .filter((x) => x.combinedGroupId === c.combinedGroupId)
      .reduce((s, x) => s + (x.weightMt ?? 0), 0);
    groupWeights.set(c.combinedGroupId, Math.round(sum * 1000) / 1000);
  }

  return keyed.map((c, i) => {
    let tag = '';
    let groupWeightMt: number | null = null;
    if (c.combinedGroupId && (groupCounts.get(c.combinedGroupId) ?? 0) >= 2) {
      if (!tagByGroup.has(c.combinedGroupId)) {
        cgIndex += 1;
        tagByGroup.set(c.combinedGroupId, `CG-${cgIndex}`);
      }
      tag = tagByGroup.get(c.combinedGroupId) ?? '';
      groupWeightMt = groupWeights.get(c.combinedGroupId) ?? null;
    }
    const { _grp, ...rest } = c;
    return {
      ...rest,
      sno: i + 1,
      combinedGroupTag: tag,
      groupWeightMt,
    };
  });
}

export function pickCrewName(
  crew: Array<{ operatorName?: string; roleCode?: string }>,
  pattern: RegExp,
): string {
  const hit = crew.find((c) => pattern.test(c.roleCode ?? ''));
  return dash(hit?.operatorName);
}

export function rejectionKgFromCoils(coils: CoilDetailRow[]): number {
  return coils
    .filter((c) => c.status === 'REJECTED')
    .reduce((sum, c) => sum + (c.weightMt ?? 0) * 1000, 0);
}
