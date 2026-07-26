import { sql } from 'kysely';
import { reportingDb } from '../db';
import { currentPlantDate, formatDbDate, plantDaysBetween, postgresDateOnly } from '@m1/shared-validation';

export type PlantHeadBacklogFilters = {
  machineCode?: string | null;
  search?: string | null;
};

export type PlantHeadBacklogMachine = {
  machineCode: string;
  machineName: string;
};

export type PlantHeadBacklogOrder = {
  batchNumber: string;
  batchId: string;
  coilNo: string | undefined;
  motherCoil: string | undefined;
  slitId: string | undefined;
  planDate: string;
  shiftCode: string;
  status: string;
  machineCode: string | undefined;
  machineName: string | undefined;
  stage: string | undefined;
  customer: string | undefined;
  grade: string | undefined;
  weightMt: number;
  daysPending: number;
};

/** Incomplete = missing crm_order row OR status not COMPLETED/REJECTED. */
export function plantHeadIncompleteOrderFilter(eb: any) {
  return eb.or([
    eb('o.status', 'is', null),
    eb('o.status', 'not in', ['COMPLETED', 'REJECTED']),
  ]);
}

/** Exclude OFFLINE machines; keep null machine_code / unknown machine rows. */
export function plantHeadActiveMachineFilter(eb: any) {
  return eb.or([
    eb('pb.machine_code', 'is', null),
    eb('m.machine_status', 'is', null),
    eb('m.machine_status', '!=', 'OFFLINE'),
  ]);
}

/** Belt-and-suspenders when joins fan out (duplicate machine/order matches). */
export function uniqueByBatchId<T extends { batch_id: unknown }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const id = String(row.batch_id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function applyOptionalFilters<T>(qb: T, filters: PlantHeadBacklogFilters): T {
  const machineCode = filters.machineCode?.trim() || null;
  const search = filters.search?.trim() || null;
  let next = qb as any;
  if (machineCode) {
    next = next.where('pb.machine_code', '=', machineCode);
  }
  if (search) {
    const pattern = `%${search}%`;
    next = next.where((eb: any) =>
      eb.or([
        eb('pb.batch_number', 'ilike', pattern),
        eb('pb.coil_no', 'ilike', pattern),
        eb('pb.slit_id', 'ilike', pattern),
        eb('pb.customer_name', 'ilike', pattern),
      ]),
    );
  }
  return next as T;
}

function backlogJoinedQuery() {
  const today = postgresDateOnly(currentPlantDate());
  return reportingDb
    .selectFrom('planning.ppc_batch as pb')
    .leftJoin('txn.crm_order as o', 'o.batch_id', 'pb.batch_id')
    .leftJoin('master.machine as m', 'm.machine_code', 'pb.machine_code')
    .where(sql`pb.plan_date`, '<', sql`${today}::date`)
    .where(plantHeadIncompleteOrderFilter)
    .where(plantHeadActiveMachineFilter);
}

/** Plant-wide backlog count — identical filter set as the detail list. */
export async function countPlantHeadBacklog(): Promise<number> {
  const row = await backlogJoinedQuery()
    .select(sql<number>`count(distinct pb.batch_id)`.as('cnt'))
    .executeTakeFirst();
  return Number(row?.cnt ?? 0);
}

function mapBacklogOrder(row: {
  batch_id: unknown;
  batch_number: string;
  coil_no: string | null;
  slit_id: string | null;
  plan_date: Date | string;
  shift_code: string;
  machine_code: string | null;
  sub_process: string | null;
  customer_name: string | null;
  grade_code: string | null;
  ppc_weight_mt: number | string | null;
  order_status: string | null;
  machine_name: string | null;
}, todayKey: string): PlantHeadBacklogOrder {
  const planDateKey = formatDbDate(row.plan_date as Date | string);
  const daysPending = Math.max(0, plantDaysBetween(planDateKey, todayKey));
  const subProcess = String(row.sub_process ?? '');
  const stageLabel = subProcess === 'SKIN_PASS'
    ? 'Skin Pass'
    : subProcess === 'ROLLING'
      ? 'Rolling'
      : subProcess || undefined;
  const coilNo = row.coil_no ?? undefined;
  return {
    batchNumber: row.batch_number,
    batchId: String(row.batch_id),
    coilNo,
    motherCoil: coilNo,
    slitId: row.slit_id ?? undefined,
    planDate: planDateKey,
    shiftCode: row.shift_code,
    status: row.order_status ?? 'PENDING',
    machineCode: row.machine_code ?? undefined,
    machineName: row.machine_name ?? undefined,
    stage: stageLabel,
    customer: row.customer_name ?? undefined,
    grade: row.grade_code ?? undefined,
    weightMt: Number(row.ppc_weight_mt ?? 0),
    daysPending,
  };
}

/**
 * Detail list + availableMachines (unfiltered by machineCode/search).
 * Count (`total`) is the filtered set length after distinct-by-batch_id.
 */
export async function listPlantHeadBacklog(filters: PlantHeadBacklogFilters = {}): Promise<{
  total: number;
  /** Same definition as KPI `backlogCount` (ignores machineCode/search). */
  totalUnfiltered: number;
  orders: PlantHeadBacklogOrder[];
  availableMachines: PlantHeadBacklogMachine[];
}> {
  const todayKey = currentPlantDate();

  const [filteredRows, machineRows, totalUnfiltered] = await Promise.all([
    applyOptionalFilters(backlogJoinedQuery(), filters)
      .select([
        'pb.batch_id',
        'pb.batch_number',
        'pb.coil_no',
        'pb.slit_id',
        'pb.plan_date',
        'pb.shift_code',
        'pb.machine_code',
        'pb.sub_process',
        'pb.customer_name',
        'pb.grade_code',
        'pb.ppc_weight_mt',
        'o.status as order_status',
        'm.name as machine_name',
      ])
      .orderBy('pb.plan_date', 'asc')
      .orderBy('pb.batch_number', 'asc')
      .execute(),
    backlogJoinedQuery()
      .select(['pb.machine_code', 'm.name as machine_name'])
      .where('pb.machine_code', 'is not', null)
      .execute(),
    countPlantHeadBacklog(),
  ]);

  const orders = uniqueByBatchId(filteredRows).map((row) => mapBacklogOrder(row, todayKey));

  const machineMap = new Map<string, string>();
  for (const row of machineRows) {
    const code = row.machine_code;
    if (!code) continue;
    if (!machineMap.has(code)) {
      machineMap.set(code, row.machine_name ?? code);
    }
  }
  const availableMachines = [...machineMap.entries()]
    .map(([machineCode, machineName]) => ({ machineCode, machineName }))
    .sort((a, b) => a.machineCode.localeCompare(b.machineCode));

  return { total: orders.length, totalUnfiltered, orders, availableMachines };
}
