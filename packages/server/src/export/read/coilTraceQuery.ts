import { db } from '../../db';
import type { AuthUser } from '../../services/authService';
import { getScopedLineCodes } from '../../auth/lineAccessPolicy';
import type { CoilTraceRdm, CoilTraceTimelineStep } from '../types/rdm';
import type { ProcessRunRow } from './types';
import { CoilLineageWalker } from './CoilLineageWalker';
import { ExportReadRepository } from './ExportReadRepository';

const WIDE_DATE_FROM = '2000-01-01';
const WIDE_DATE_TO = '2099-12-31';

export const PROCESS_ORDER: Record<string, number> = {
  HRS: 1,
  PKL: 2,
  '6HI': 3,
  CRM: 3,
  ANN: 4,
  SKP: 5,
  RWD: 6,
  CRS: 7,
  CTL: 8,
};

export const PROCESS_LABELS: Record<string, string> = {
  HRS: 'HR Slitting',
  PKL: 'Pickling',
  '6HI': 'Cold Rolling Mill',
  CRM: 'Cold Rolling Mill',
  ANN: 'Annealing',
  SKP: 'Skin Pass',
  RWD: 'Rewinding',
  CRS: 'CR Slitting',
  CTL: 'Cut-to-Length',
};

export interface CoilTraceScope {
  mode: 'single' | 'batch';
  coilNo?: string;
  customerCode?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function parseCoilTraceScope(scope: Record<string, unknown>): CoilTraceScope {
  const coilNo = scope.coil_no ?? scope.coilNo;
  const customerCode = scope.customer_code ?? scope.customerCode;
  const dateFrom = scope.date_from ?? scope.dateFrom;
  const dateTo = scope.date_to ?? scope.dateTo;

  if (coilNo) {
    return { mode: 'single', coilNo: String(coilNo).trim() };
  }

  if (customerCode && dateFrom && dateTo) {
    const from = String(dateFrom);
    const to = String(dateTo);
    if (to < from) throw new Error('date_to must be on or after date_from');
    return {
      mode: 'batch',
      customerCode: String(customerCode).trim(),
      dateFrom: from,
      dateTo: to,
    };
  }

  throw new Error('coil_no or (customer_code, date_from, date_to) is required');
}

export function sortProcessRuns(
  runs: ProcessRunRow[],
  depthMap: Map<string, number>,
): ProcessRunRow[] {
  return [...runs].sort((a, b) => {
    const depthA = depthMap.get(a.coilNo) ?? 0;
    const depthB = depthMap.get(b.coilNo) ?? 0;
    if (depthA !== depthB) return depthA - depthB;

    const procA = PROCESS_ORDER[a.processCode] ?? 99;
    const procB = PROCESS_ORDER[b.processCode] ?? 99;
    if (procA !== procB) return procA - procB;

    const dateCmp = a.prodDate.localeCompare(b.prodDate);
    if (dateCmp !== 0) return dateCmp;
    return a.shiftCode.localeCompare(b.shiftCode);
  });
}

export function runToTimelineStep(
  run: ProcessRunRow,
  seq: number,
  defects: string[],
): CoilTraceTimelineStep {
  const attrs = run.attrs ?? {};
  const keyValues: Record<string, unknown> = {
    coil_no: run.coilNo,
    area_code: run.areaCode,
    weight_mt: run.outputWeightMt,
    thk_mm: run.outputThkMm,
    width_mm: attrs.width_mm ?? null,
    for_ctl_flag: run.status === 'FOR_CTL',
  };

  const step: CoilTraceTimelineStep = {
    seq,
    process: PROCESS_LABELS[run.processCode] ?? run.processCode,
    date: run.prodDate,
    shift: run.shiftCode,
    operator: run.operatorCode,
    keyValues,
    quality: { defects },
    status: run.status,
  };

  if (run.processCode === 'ANN') {
    if (attrs.charge_no) step.chargeNo = String(attrs.charge_no);
    if (attrs.base_no) step.baseNo = String(attrs.base_no);
  }

  return step;
}

async function fetchDefectLabels(coilNos: string[]): Promise<Map<string, string[]>> {
  const byCoil = new Map<string, string[]>();
  if (coilNos.length === 0) return byCoil;

  const rows = await db
    .selectFrom('txn.defect_entry as de')
    .innerJoin('master.defect_code as dc', 'de.defect_code', 'dc.defect_code')
    .select(['de.coil_no', 'de.defect_code', 'dc.description'])
    .where('de.coil_no', 'in', coilNos)
    .execute();

  for (const row of rows) {
    if (!row.coil_no) continue;
    const label = row.description ? `${row.defect_code}: ${row.description}` : row.defect_code;
    const list = byCoil.get(row.coil_no) ?? [];
    list.push(label);
    byCoil.set(row.coil_no, list);
  }
  return byCoil;
}

async function loadCoilHeader(coilNo: string) {
  const row = await db
    .selectFrom('coil.coil as c')
    .leftJoin('master.customer as cu', 'c.customer_id', 'cu.customer_id')
    .select([
      'c.coil_no',
      'c.grade_code',
      'c.parent_coil_no',
      'cu.customer_name',
      'cu.customer_code',
    ])
    .where('c.coil_no', '=', coilNo)
    .executeTakeFirst();

  return row;
}

export async function buildCoilTraceRdm(coilNo: string): Promise<CoilTraceRdm> {
  const target = await CoilLineageWalker.resolveTargetCoil(coilNo);
  const chain = await CoilLineageWalker.lineageChain(target);
  if (chain.length === 0) {
    throw new Error(`Coil not found: ${coilNo}`);
  }

  const depthMap = CoilLineageWalker.lineageDepthMap(chain);
  const lineageNodes = await CoilLineageWalker.walkLineageRootFirst(target);
  const sourceCoilNo = lineageNodes[0]?.coilNo ?? target;
  const leafForCtl = lineageNodes.some((n) => n.forCtlFlag);

  const allRuns: ProcessRunRow[] = [];
  for (const c of chain) {
    const runs = await ExportReadRepository.fetchRuns({
      dateFrom: WIDE_DATE_FROM,
      dateTo: WIDE_DATE_TO,
      coilNo: c,
    });
    allRuns.push(...runs);
  }

  const sorted = sortProcessRuns(allRuns, depthMap);
  const defectsByCoil = await fetchDefectLabels(chain);

  const timeline = sorted.map((run, idx) =>
    runToTimelineStep(run, idx + 1, defectsByCoil.get(run.coilNo) ?? []),
  );

  const headerRow = await loadCoilHeader(target);

  return {
    report: 'COIL_TRACE',
    coilNo: target,
    header: {
      grade: headerRow?.grade_code ?? lineageNodes[lineageNodes.length - 1]?.gradeCode ?? null,
      customer: headerRow?.customer_name ?? headerRow?.customer_code ?? null,
      sourceCoilNo,
      forCtlFlag: leafForCtl,
    },
    timeline,
  };
}

export async function listCoilsForBatch(
  customerCode: string,
  dateFrom: string,
  dateTo: string,
): Promise<string[]> {
  const runs = await ExportReadRepository.fetchRuns({ dateFrom, dateTo });
  const customerCoils = await db
    .selectFrom('coil.coil as c')
    .innerJoin('master.customer as cu', 'c.customer_id', 'cu.customer_id')
    .select('c.coil_no')
    .where('cu.customer_code', '=', customerCode)
    .execute();

  const allowed = new Set(customerCoils.map((c) => c.coil_no));
  const coils = new Set<string>();
  for (const run of runs) {
    if (allowed.has(run.coilNo)) coils.add(run.coilNo);
  }
  return [...coils].sort();
}

async function buildWithAccessCheck(coilNo: string, user: AuthUser): Promise<CoilTraceRdm> {
  const target = await CoilLineageWalker.resolveTargetCoil(coilNo);
  const chain = await CoilLineageWalker.lineageChain(target);
  const runs: ProcessRunRow[] = [];
  for (const c of chain) {
    runs.push(...await ExportReadRepository.fetchRuns({
      dateFrom: WIDE_DATE_FROM,
      dateTo: WIDE_DATE_TO,
      coilNo: c,
    }));
  }
  assertCoilTraceAccess(user, runs);
  return buildCoilTraceRdm(coilNo);
}

export async function fetchCoilTraceBatch(
  scope: Record<string, unknown>,
  user: AuthUser,
): Promise<CoilTraceRdm[]> {
  const parsed = parseCoilTraceScope(scope);

  if (parsed.mode === 'single') {
    return [await buildWithAccessCheck(parsed.coilNo!, user)];
  }

  const coils = await listCoilsForBatch(
    parsed.customerCode!,
    parsed.dateFrom!,
    parsed.dateTo!,
  );

  if (coils.length === 0) {
    throw new Error(`No coils found for customer ${parsed.customerCode} in date range`);
  }

  return Promise.all(coils.map((c) => buildWithAccessCheck(c, user)));
}

export function assertCoilTraceAccess(user: AuthUser, runs: ProcessRunRow[]): void {
  const scoped = getScopedLineCodes(user, 'READ');
  if (scoped === null) return;

  for (const run of runs) {
    const code = run.processCode === 'ROLLING' ? 'CRM' : run.processCode;
    if (!scoped.includes(run.processCode) && !scoped.includes(code)) {
      throw new Error(`No read access to line ${run.processCode} for coil trace`);
    }
  }
}
