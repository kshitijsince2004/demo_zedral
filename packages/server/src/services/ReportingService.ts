import { sql } from 'kysely';
import { reportingDb } from '../db';
import {
  buildShiftDurationMap,
  calcOee,
  calcPerformance,
  calcQuality,
  lineOeeFromTotals,
  pctChange,
  PLANT_OEE_TARGET,
  REJECTION_COST_PER_MT,
  resolveShiftMinutes,
  round1,
  round2,
} from '../utils/kpiCalculator';
import type { PlantHeadWindow } from '../reporting/plantHeadWindow';
import {
  buildDrilldownEnvelope,
  type PlantHeadDrilldownMetric,
} from '../reporting/plantHeadDrilldown';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReportingPeriod = 'shift' | 'day' | 'week' | 'month';

interface ShiftRow {
  shift_log_id: string;
  lineId: string;
  lineName: string;
  target_mt: number;
  total_prod_mt: number;
  prod_date: Date;
  shift_code: string;
  state: string;
}

interface PeriodRange {
  currentFrom: Date;
  currentTo: Date;
  previousFrom: Date;
  previousTo: Date;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toNum(value: unknown): number {
  return Number(value || 0);
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolvePeriodRanges(period: ReportingPeriod, now = new Date()): PeriodRange {
  const today = startOfDay(now);

  switch (period) {
    case 'shift':
      return {
        currentFrom: today,
        currentTo: now,
        previousFrom: new Date(today.getTime() - DAY_MS),
        previousTo: new Date(today.getTime() - 1),
      };
    case 'week':
      return {
        currentFrom: new Date(today.getTime() - 6 * DAY_MS),
        currentTo: now,
        previousFrom: new Date(today.getTime() - 13 * DAY_MS),
        previousTo: new Date(today.getTime() - 7 * DAY_MS - 1),
      };
    case 'month':
      return {
        currentFrom: new Date(today.getTime() - 29 * DAY_MS),
        currentTo: now,
        previousFrom: new Date(today.getTime() - 59 * DAY_MS),
        previousTo: new Date(today.getTime() - 30 * DAY_MS - 1),
      };
    case 'day':
    default:
      return {
        currentFrom: today,
        currentTo: now,
        previousFrom: new Date(today.getTime() - DAY_MS),
        previousTo: new Date(today.getTime() - 1),
      };
  }
}

async function resolveProcessIds(lines: string[]): Promise<number[]> {
  if (lines.length === 0) return [];
  const rows = await reportingDb
    .selectFrom('master.process')
    .select('process_id')
    .where('code', 'in', lines)
    .execute();
  return rows.map((r) => r.process_id);
}

async function fetchShiftRows(
  lines: string[],
  from: Date,
  to: Date,
  states?: string[],
  filters?: { shifts?: string[]; grades?: string[]; customers?: string[]; coils?: string[] }
): Promise<ShiftRow[]> {
  let query = reportingDb
    .selectFrom('txn.shift_log as sl')
    .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
    .select([
      'sl.shift_log_id',
      'p.code as lineId',
      'p.name as lineName',
      'sl.target_mt',
      'sl.total_prod_mt',
      'sl.prod_date',
      'sl.shift_code',
      'sl.state',
    ])
    .where('sl.prod_date', '>=', from)
    .where('sl.prod_date', '<=', to);

  if (lines.length > 0) {
    const processIds = await resolveProcessIds(lines);
    if (processIds.length === 0) return [];
    query = query.where('sl.process_id', 'in', processIds);
  }

  if (states && states.length > 0) {
    query = query.where('sl.state', 'in', states);
  }

  if (filters?.shifts && filters.shifts.length > 0) {
    query = query.where('sl.shift_code', 'in', filters.shifts);
  }

  // Note: grade, customer, and coil filtering requires joining specific
  // production tables (txn.prod_*) or the crm6_order table.
  // This is a stub for where that logic would go if a unified view existed.

  const rows = await query.orderBy('sl.prod_date', 'desc').execute();
  return rows.map((r) => ({
    shift_log_id: String(r.shift_log_id),
    lineId: r.lineId,
    lineName: r.lineName,
    target_mt: toNum(r.target_mt),
    total_prod_mt: toNum(r.total_prod_mt),
    prod_date: new Date(r.prod_date),
    shift_code: r.shift_code,
    state: r.state,
  }));
}

async function fetchDowntimeByShift(shiftIds: string[]): Promise<Record<string, number>> {
  if (shiftIds.length === 0) return {};

  const rows = await reportingDb
    .selectFrom('txn.stoppage_entry')
    .select([
      'shift_log_id',
      reportingDb.fn.sum<number>('duration_min').as('minutes'),
    ])
    .where('shift_log_id', 'in', shiftIds)
    .groupBy('shift_log_id')
    .execute();

  const map: Record<string, number> = {};
  for (const row of rows) {
    map[String(row.shift_log_id)] = toNum(row.minutes);
  }
  return map;
}

async function fetchShiftDurationMap(): Promise<Record<string, number>> {
  const rows = await reportingDb
    .selectFrom('master.shift')
    .select(['shift_code', 'start_time', 'end_time'])
    .orderBy('start_time', 'asc')
    .execute();

  return buildShiftDurationMap(
    rows.map((row) => ({
      shiftCode: row.shift_code,
      startTime: String(row.start_time).slice(0, 5),
      endTime: String(row.end_time).slice(0, 5),
    })),
  );
}

async function fetchLossByShift(shiftIds: string[]): Promise<Record<string, number>> {
  if (shiftIds.length === 0) return {};

  const addLoss = (map: Record<string, number>, shiftId: unknown, mt: unknown) => {
    const key = String(shiftId);
    map[key] = (map[key] || 0) + toNum(mt);
  };

  const map: Record<string, number> = {};

  const hrs = await reportingDb
    .selectFrom('txn.prod_hrs')
    .select(['shift_log_id', 'scrap_mt'])
    .where('shift_log_id', 'in', shiftIds)
    .execute();
  hrs.forEach((r) => addLoss(map, r.shift_log_id, r.scrap_mt));

  const crm = await reportingDb
    .selectFrom('txn.prod_crm')
    .select(['shift_log_id', 'scrap_mt'])
    .where('shift_log_id', 'in', shiftIds)
    .execute();
  crm.forEach((r) => addLoss(map, r.shift_log_id, r.scrap_mt));

  const crs = await reportingDb
    .selectFrom('txn.prod_crs')
    .select(['shift_log_id', 'rejection_id_mt', 'rejection_od_mt', 'hold_mt'])
    .where('shift_log_id', 'in', shiftIds)
    .execute();
  crs.forEach((r) => {
    addLoss(map, r.shift_log_id, toNum(r.rejection_id_mt) + toNum(r.rejection_od_mt) + toNum(r.hold_mt));
  });

  const ctl = await reportingDb
    .selectFrom('txn.prod_ctl')
    .select(['shift_log_id', 'rejection_mt', 'hold_mt'])
    .where('shift_log_id', 'in', shiftIds)
    .execute();
  ctl.forEach((r) => addLoss(map, r.shift_log_id, toNum(r.rejection_mt) + toNum(r.hold_mt)));

  return map;
}

function aggregateLineOee(
  shifts: ShiftRow[],
  downtime: Record<string, number>,
  loss: Record<string, number>,
  shiftDurationMap: Record<string, number>,
): Array<{ lineId: string; oee: number; availability: number; performance: number; quality: number }> {
  const byLine: Record<
    string,
    { target: number; prod: number; downtime: number; loss: number; shiftMinutes: number }
  > = {};

  for (const shift of shifts) {
    if (!byLine[shift.lineId]) {
      byLine[shift.lineId] = { target: 0, prod: 0, downtime: 0, loss: 0, shiftMinutes: 0 };
    }
    const bucket = byLine[shift.lineId];
    bucket.target += shift.target_mt;
    bucket.prod += shift.total_prod_mt;
    bucket.downtime += downtime[shift.shift_log_id] || 0;
    bucket.loss += loss[shift.shift_log_id] || 0;
    bucket.shiftMinutes += resolveShiftMinutes(shift.shift_code, shiftDurationMap);
  }

  return Object.entries(byLine).map(([lineId, totals]) => ({
    lineId,
    ...lineOeeFromTotals(
      totals.target,
      totals.prod,
      totals.downtime,
      totals.loss,
      totals.shiftMinutes,
    ),
  }));
}

function plantWideOee(
  lineOee: Array<{ oee: number; availability: number; performance: number; quality: number }>,
): number {
  if (lineOee.length === 0) return 0;
  const avg = lineOee.reduce((sum, l) => sum + l.oee, 0) / lineOee.length;
  return round1(Math.min(Math.max(avg, 0), 100));
}

function plantWideApq(
  lineOee: Array<{ availability: number; performance: number; quality: number }>,
): { availability: number; performance: number; quality: number } {
  if (lineOee.length === 0) {
    return { availability: 0, performance: 0, quality: 0 };
  }
  const n = lineOee.length;
  return {
    availability: round1(lineOee.reduce((sum, l) => sum + l.availability, 0) / n),
    performance: round1(lineOee.reduce((sum, l) => sum + l.performance, 0) / n),
    quality: round1(lineOee.reduce((sum, l) => sum + l.quality, 0) / n),
  };
}

function sumShiftProduction(shifts: ShiftRow[]): number {
  return round1(shifts.reduce((sum, shift) => sum + shift.total_prod_mt, 0));
}

const PROD_ENTRY_TABLES = [
  'txn.prod_hrs',
  'txn.prod_pkl',
  'txn.prod_crm',
  'txn.prod_crs',
  'txn.prod_ctl',
  'txn.prod_rwd',
  'txn.prod_skp',
  'txn.prod_glv',
] as const;

async function fetchEntryIdsForShifts(shiftIds: string[]): Promise<string[]> {
  if (shiftIds.length === 0) return [];

  const ids = new Set<string>();
  await Promise.all(
    PROD_ENTRY_TABLES.map(async (table) => {
      const rows = await reportingDb
        .selectFrom(table)
        .select('entry_id')
        .where('shift_log_id', 'in', shiftIds)
        .execute();
      for (const row of rows) {
        ids.add(String(row.entry_id));
      }
    }),
  );
  return [...ids];
}

function windowStart(windowDays: number, end = new Date()): Date {
  const from = new Date(end);
  from.setDate(from.getDate() - (windowDays - 1));
  return from;
}

async function fetchTopDefects(
  entryIds: string[],
  previousEntryIds: string[],
): Promise<
  Array<{
    defectCode: string;
    defectName: string;
    count: number;
    wowDelta: number;
  }>
> {
  if (entryIds.length === 0) return [];

  const currentRows = await reportingDb
    .selectFrom('txn.defect_entry as de')
    .innerJoin('master.defect_code as dc', 'de.defect_code', 'dc.defect_code')
    .select([
      'de.defect_code as defectCode',
      'dc.description as defectName',
      reportingDb.fn.count<number>(sql`de.defect_id`).as('count'),
    ])
    .where('de.entry_id', 'in', entryIds)
    .groupBy(['de.defect_code', 'dc.description'])
    .orderBy('count', 'desc')
    .limit(10)
    .execute();

  const prevCounts: Record<string, number> = {};
  if (previousEntryIds.length > 0) {
    const prevRows = await reportingDb
      .selectFrom('txn.defect_entry as de')
      .select([
        'de.defect_code as defectCode',
        reportingDb.fn.count<number>(sql`de.defect_id`).as('count'),
      ])
      .where('de.entry_id', 'in', previousEntryIds)
      .groupBy('de.defect_code')
      .execute();
    for (const row of prevRows) {
      prevCounts[row.defectCode] = Number(row.count || 0);
    }
  }

  return currentRows.map((d) => {
    const count = Number(d.count || 0);
    const prev = prevCounts[d.defectCode] || 0;
    return {
      defectCode: d.defectCode,
      defectName: d.defectName || d.defectCode,
      count,
      wowDelta: count - prev,
    };
  });
}

export interface PlantHeadFilters {
  lines?: string[];
  shifts?: string[];
  grades?: string[];
  customers?: string[];
  coils?: string[];
}

export class ReportingService {
  static async getSupervisorDashboard(lines: string[]) {
    let activeShiftsQuery = reportingDb
      .selectFrom('txn.shift_log as sl')
      .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
      .leftJoin('security.app_user as u', 'sl.shift_manager_id', 'u.user_id')
      .select([
        'sl.shift_log_id',
        'p.code as lineId',
        'p.name as lineName',
        'sl.shift_code as shiftCode',
        'u.full_name as operatorName',
      ])
      .where('sl.state', '=', 'DRAFT');

    if (lines.length > 0) {
      const processIds = await resolveProcessIds(lines);
      if (processIds.length > 0) {
        activeShiftsQuery = activeShiftsQuery.where('sl.process_id', 'in', processIds);
      }
    }

    const activeShifts = await activeShiftsQuery.execute();

    const lineStatuses = await Promise.all(
      activeShifts.map(async (shift) => {
        const runningStoppage = await reportingDb
          .selectFrom('txn.stoppage_entry')
          .select('stoppage_id')
          .where('shift_log_id', '=', shift.shift_log_id)
          .where('time_to', 'is', null)
          .executeTakeFirst();

        return {
          lineId: shift.lineId,
          lineName: shift.lineName,
          status: runningStoppage ? ('STOPPED' as const) : ('RUNNING' as const),
          shiftCode: shift.shiftCode,
          operatorName: shift.operatorName || 'Unknown',
        };
      }),
    );

    let pendingQuery = reportingDb
      .selectFrom('txn.shift_log')
      .select(reportingDb.fn.count<number>('shift_log_id').as('count'))
      .where('state', '=', 'SUBMITTED');

    if (lines.length > 0) {
      const processIds = await resolveProcessIds(lines);
      if (processIds.length > 0) {
        pendingQuery = pendingQuery.where('process_id', 'in', processIds);
      }
    }

    const pendingRes = await pendingQuery.executeTakeFirst();
    const pendingReviewCount = Number(pendingRes?.count || 0);

    const recentFrom = new Date();
    recentFrom.setDate(recentFrom.getDate() - 30);
    const [recentShifts, shiftDurationMap] = await Promise.all([
      fetchShiftRows(lines, recentFrom, new Date()),
      fetchShiftDurationMap(),
    ]);
    const shiftIds = recentShifts.map((s) => s.shift_log_id);
    const downtime = await fetchDowntimeByShift(shiftIds);
    const loss = await fetchLossByShift(shiftIds);

    const lineOee = aggregateLineOee(recentShifts, downtime, loss, shiftDurationMap);
    const filteredLineOee =
      lines.length > 0 ? lineOee.filter((o) => lines.includes(o.lineId)) : lineOee;

    const downtimeShiftIds =
      activeShifts.length > 0
        ? activeShifts.map((s) => String(s.shift_log_id))
        : shiftIds.slice(0, 20);

    let downtimePareto: Array<{ reason: string; minutes: number }> = [];
    if (downtimeShiftIds.length > 0) {
      const stoppages = await reportingDb
        .selectFrom('txn.stoppage_entry as se')
        .innerJoin('master.stoppage_code as sc', 'se.stoppage_code', 'sc.stoppage_code')
        .select([
          'sc.description as reason',
          reportingDb.fn.sum<number>(sql`se.duration_min`).as('minutes'),
        ])
        .where('se.shift_log_id', 'in', downtimeShiftIds)
        .groupBy('sc.description')
        .orderBy('minutes', 'desc')
        .limit(10)
        .execute();

      downtimePareto = stoppages.map((s) => ({
        reason: s.reason,
        minutes: toNum(s.minutes),
      }));
    }

    let totalProd = 0;
    let totalTarget = 0;
    let totalLoss = 0;
    for (const shift of recentShifts) {
      totalProd += shift.total_prod_mt;
      totalTarget += shift.target_mt;
      totalLoss += loss[shift.shift_log_id] || 0;
    }

    const yieldPct = calcQuality(Math.max(totalProd - totalLoss, 0), totalProd);
    const rejectionRatePct =
      totalProd > 0 ? round1(Math.min((totalLoss / totalProd) * 100, 100)) : 0;

    return {
      lineStatuses,
      pendingReviewCount,
      lineOee: filteredLineOee,
      downtimePareto,
      yieldPct,
      rejectionRatePct,
    };
  }

  static async getPlantHeadDashboard(windowDays: PlantHeadWindow = 7, filters: PlantHeadFilters = {}) {
    const now = new Date();
    const trendFrom = windowStart(windowDays, now);
    const [shifts, shiftDurationMap] = await Promise.all([
      fetchShiftRows(filters.lines || [], trendFrom, now, undefined, filters),
      fetchShiftDurationMap(),
    ]);
    const shiftIds = shifts.map((s) => s.shift_log_id);
    const downtime = await fetchDowntimeByShift(shiftIds);
    const loss = await fetchLossByShift(shiftIds);

    const lineOee = aggregateLineOee(shifts, downtime, loss, shiftDurationMap);
    const plantWideOeeValue = plantWideOee(lineOee);

    const oeeByDate: Record<
      string,
      { target: number; prod: number; downtime: number; loss: number; shiftMinutes: number }
    > = {};
    for (const shift of shifts) {
      const key = formatDateKey(shift.prod_date);
      if (!oeeByDate[key]) {
        oeeByDate[key] = { target: 0, prod: 0, downtime: 0, loss: 0, shiftMinutes: 0 };
      }
      const bucket = oeeByDate[key];
      bucket.target += shift.target_mt;
      bucket.prod += shift.total_prod_mt;
      bucket.downtime += downtime[shift.shift_log_id] || 0;
      bucket.loss += loss[shift.shift_log_id] || 0;
      bucket.shiftMinutes += resolveShiftMinutes(shift.shift_code, shiftDurationMap);
    }

    const oeeTrend = Object.entries(oeeByDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, totals]) => {
        const { oee } = lineOeeFromTotals(
          totals.target,
          totals.prod,
          totals.downtime,
          totals.loss,
          totals.shiftMinutes,
        );
        return {
          date: formatDayLabel(new Date(dateKey)),
          oee: round1(Math.min(Math.max(oee, 0), 100)),
        };
      });

    const planByLine: Record<string, { lineName: string; planned: number; actual: number }> = {};
    for (const shift of shifts) {
      if (!planByLine[shift.lineId]) {
        planByLine[shift.lineId] = { lineName: shift.lineName, planned: 0, actual: 0 };
      }
      planByLine[shift.lineId].planned += shift.target_mt;
      planByLine[shift.lineId].actual += shift.total_prod_mt;
    }

    const productionVsPlan = Object.entries(planByLine).map(([lineId, row]) => {
      const planned = round1(row.planned);
      const actual = round1(row.actual);
      const attainmentPct =
        planned > 0 ? round1(Math.min((actual / planned) * 100, 100)) : 0;
      return {
        lineId,
        lineName: row.lineName,
        planned,
        actual,
        attainmentPct,
        throughput: round2(row.actual),
      };
    });

    const qualityTrend = Object.entries(oeeByDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, totals]) => {
        const yieldPct = calcQuality(Math.max(totals.prod - totals.loss, 0), totals.prod);
        const rejectionRatePct =
          totals.prod > 0 ? round1(Math.min((totals.loss / totals.prod) * 100, 100)) : 0;
        return {
          date: formatDayLabel(new Date(dateKey)),
          yieldPct: Math.min(Math.max(yieldPct, 0), 100),
          rejectionRatePct: Math.min(Math.max(rejectionRatePct, 0), 100),
        };
      });

    const prevTo = new Date(trendFrom);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = windowStart(windowDays, prevTo);
    const previousShifts = await fetchShiftRows([], prevFrom, prevTo);
    const [entryIds, previousEntryIds] = await Promise.all([
      fetchEntryIdsForShifts(shiftIds),
      fetchEntryIdsForShifts(previousShifts.map((s) => s.shift_log_id)),
    ]);
    const topDefects = await fetchTopDefects(entryIds, previousEntryIds);

    let downtimeDrivers: Array<{
      reason: string;
      totalMinutes: number;
      occurrences: number;
      type: 'PLANNED' | 'UNPLANNED';
    }> = [];
    if (shiftIds.length > 0) {
      const driverRows = await reportingDb
        .selectFrom('txn.stoppage_entry as se')
        .innerJoin('master.stoppage_code as sc', 'se.stoppage_code', 'sc.stoppage_code')
        .select([
          'sc.description as reason',
          reportingDb.fn.sum<number>(sql`se.duration_min`).as('totalMinutes'),
          reportingDb.fn.count<number>(sql`se.stoppage_id`).as('occurrences'),
          sql<boolean>`bool_and(sc.is_planned)`.as('isPlanned'),
        ])
        .where('se.shift_log_id', 'in', shiftIds)
        .groupBy('sc.description')
        .orderBy('totalMinutes', 'desc')
        .limit(10)
        .execute();

      downtimeDrivers = driverRows.map((d) => ({
        reason: d.reason,
        totalMinutes: toNum(d.totalMinutes),
        occurrences: Number(d.occurrences || 0),
        type: d.isPlanned ? 'PLANNED' : 'UNPLANNED',
      }));
    }

    const previousWindowShifts = await fetchShiftRows(
      filters.lines || [],
      prevFrom,
      prevTo,
      undefined,
      filters,
    );
    const previousWindowIds = previousWindowShifts.map((s) => s.shift_log_id);
    const [previousWindowDowntime, previousWindowLoss] = await Promise.all([
      fetchDowntimeByShift(previousWindowIds),
      fetchLossByShift(previousWindowIds),
    ]);
    const previousLineOee = aggregateLineOee(
      previousWindowShifts,
      previousWindowDowntime,
      previousWindowLoss,
      shiftDurationMap,
    );
    const previousApq = plantWideApq(previousLineOee);
    const previousPlantOee = plantWideOee(previousLineOee);

    const todayKey = formatDateKey(now);
    const todayShifts = shifts.filter((shift) => formatDateKey(shift.prod_date) === todayKey);
    const yesterdayStart = new Date(startOfDay(now).getTime() - DAY_MS);
    const yesterdayEnd = new Date(startOfDay(now).getTime() - 1);
    const yesterdayShifts = await fetchShiftRows(
      filters.lines || [],
      yesterdayStart,
      yesterdayEnd,
      undefined,
      filters,
    );

    const currentApq = plantWideApq(lineOee);
    const productionTodayMt = sumShiftProduction(todayShifts);
    const productionYesterdayMt = sumShiftProduction(yesterdayShifts);

    const dailyProduction = Object.entries(oeeByDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, totals]) => ({
        date: formatDayLabel(new Date(dateKey)),
        targetMt: round1(totals.target),
        actualMt: round1(totals.prod),
      }));

    return {
      window: windowDays,
      generatedAt: now.toISOString(),
      plantWideOee: plantWideOeeValue,
      oeeTarget: PLANT_OEE_TARGET,
      oeeTrend,
      productionVsPlan,
      qualityTrend,
      topDefects,
      downtimeDrivers,
      dailyProduction,
      kpiStrip: {
        productionTodayMt,
        productionTodayTrendPct: pctChange(productionTodayMt, productionYesterdayMt),
        oeePct: plantWideOeeValue,
        oeeTrendPct: pctChange(plantWideOeeValue, previousPlantOee),
        availabilityPct: currentApq.availability,
        availabilityTrendPct: pctChange(currentApq.availability, previousApq.availability),
        performancePct: currentApq.performance,
        performanceTrendPct: pctChange(currentApq.performance, previousApq.performance),
        qualityPct: currentApq.quality,
        qualityTrendPct: pctChange(currentApq.quality, previousApq.quality),
      },
    };
  }

  static async getManagementDashboard(period: ReportingPeriod) {
    const ranges = resolvePeriodRanges(period);

    const [currentShifts, previousShifts, shiftDurationMap] = await Promise.all([
      fetchShiftRows([], ranges.currentFrom, ranges.currentTo),
      fetchShiftRows([], ranges.previousFrom, ranges.previousTo),
      fetchShiftDurationMap(),
    ]);

    const currentIds = currentShifts.map((s) => s.shift_log_id);
    const previousIds = previousShifts.map((s) => s.shift_log_id);

    const [currentDowntime, previousDowntime, currentLoss, previousLoss] = await Promise.all([
      fetchDowntimeByShift(currentIds),
      fetchDowntimeByShift(previousIds),
      fetchLossByShift(currentIds),
      fetchLossByShift(previousIds),
    ]);

    const sumTotals = (
      shifts: ShiftRow[],
      downtimeMap: Record<string, number>,
      lossMap: Record<string, number>,
    ) => {
      let target = 0;
      let prod = 0;
      let downtime = 0;
      let loss = 0;
      let shiftMinutes = 0;
      for (const shift of shifts) {
        target += shift.target_mt;
        prod += shift.total_prod_mt;
        downtime += downtimeMap[shift.shift_log_id] || 0;
        loss += lossMap[shift.shift_log_id] || 0;
        shiftMinutes += resolveShiftMinutes(shift.shift_code, shiftDurationMap);
      }
      const { oee } = lineOeeFromTotals(target, prod, downtime, loss, shiftMinutes);
      const yieldPct = calcQuality(Math.max(prod - loss, 0), prod);
      const onTimePct = calcPerformance(prod, target);
      return { target, prod, downtime, loss, oee, yieldPct, onTimePct };
    };

    const current = sumTotals(currentShifts, currentDowntime, currentLoss);
    const previous = sumTotals(previousShifts, previousDowntime, previousLoss);

    return {
      period,
      throughputMt: {
        current: round1(current.prod),
        previous: round1(previous.prod),
        changePct: pctChange(current.prod, previous.prod),
      },
      oee: {
        current: current.oee,
        previous: previous.oee,
        changePct: pctChange(current.oee, previous.oee),
      },
      rejectionCost: {
        current: round1(current.loss * REJECTION_COST_PER_MT),
        previous: round1(previous.loss * REJECTION_COST_PER_MT),
        changePct: pctChange(current.loss, previous.loss),
      },
      onTimeDeliveryPct: {
        current: current.onTimePct,
        previous: previous.onTimePct,
        changePct: pctChange(current.onTimePct, previous.onTimePct),
      },
      yieldPct: {
        current: current.yieldPct,
        previous: previous.yieldPct,
        changePct: pctChange(current.yieldPct, previous.yieldPct),
      },
      downtimeMinutes: {
        current: round1(current.downtime),
        previous: round1(previous.downtime),
        changePct: pctChange(current.downtime, previous.downtime),
      },
    };
  }

  static async getDailyReport(date: string) {
    const dayStart = new Date(date);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const shifts = await fetchShiftRows([], dayStart, dayEnd);
    const shiftIds = shifts.map((s) => s.shift_log_id);
    const loss = await fetchLossByShift(shiftIds);

    let totalProductionMt = 0;
    let totalLossMt = 0;
    for (const shift of shifts) {
      totalProductionMt += shift.total_prod_mt;
      totalLossMt += loss[shift.shift_log_id] || 0;
    }

    const primeYieldPct = calcQuality(Math.max(totalProductionMt - totalLossMt, 0), totalProductionMt);

    const byLine: Record<string, { lineName: string; planned: number; actual: number; shifts: number }> = {};
    for (const shift of shifts) {
      if (!byLine[shift.lineId]) {
        byLine[shift.lineId] = { lineName: shift.lineName, planned: 0, actual: 0, shifts: 0 };
      }
      byLine[shift.lineId].planned += shift.target_mt;
      byLine[shift.lineId].actual += shift.total_prod_mt;
      byLine[shift.lineId].shifts += 1;
    }

    return {
      date,
      totalProductionMt: round1(totalProductionMt),
      primeYieldPct,
      shiftCount: shifts.length,
      byLine: Object.entries(byLine).map(([lineId, row]) => ({
        lineId,
        lineName: row.lineName,
        planned: round1(row.planned),
        actual: round1(row.actual),
        shifts: row.shifts,
      })),
    };
  }

  static async getPlantHeadDrilldown(
    metric: PlantHeadDrilldownMetric,
    windowDays: PlantHeadWindow,
    page: number,
  ) {
    const now = new Date();
    const from = windowStart(windowDays, now);
    const [shifts, shiftDurationMap] = await Promise.all([
      fetchShiftRows([], from, now),
      fetchShiftDurationMap(),
    ]);
    const shiftIds = shifts.map((s) => s.shift_log_id);
    const downtime = await fetchDowntimeByShift(shiftIds);
    const loss = await fetchLossByShift(shiftIds);

    let allRecords: Record<string, unknown>[] = [];

    switch (metric) {
      case 'production':
        allRecords = shifts.map((shift) => ({
          shiftLogId: shift.shift_log_id,
          lineId: shift.lineId,
          lineName: shift.lineName,
          prodDate: shift.prod_date.toISOString(),
          shiftCode: shift.shift_code,
          plannedMt: round1(shift.target_mt),
          actualMt: round1(shift.total_prod_mt),
        }));
        break;

      case 'oee':
        allRecords = shifts.map((shift) => {
          const shiftMinutes = resolveShiftMinutes(shift.shift_code, shiftDurationMap);
          const metrics = lineOeeFromTotals(
            shift.target_mt,
            shift.total_prod_mt,
            downtime[shift.shift_log_id] || 0,
            loss[shift.shift_log_id] || 0,
            shiftMinutes,
          );
          return {
            shiftLogId: shift.shift_log_id,
            lineId: shift.lineId,
            lineName: shift.lineName,
            prodDate: shift.prod_date.toISOString(),
            shiftCode: shift.shift_code,
            oee: metrics.oee,
            availability: metrics.availability,
            performance: metrics.performance,
            quality: metrics.quality,
          };
        });
        break;

      case 'quality':
        allRecords = shifts.map((shift) => {
          const lossMt = loss[shift.shift_log_id] || 0;
          const yieldPct = calcQuality(Math.max(shift.total_prod_mt - lossMt, 0), shift.total_prod_mt);
          const rejectionRatePct =
            shift.total_prod_mt > 0
              ? round1(Math.min((lossMt / shift.total_prod_mt) * 100, 100))
              : 0;
          return {
            shiftLogId: shift.shift_log_id,
            lineId: shift.lineId,
            lineName: shift.lineName,
            prodDate: shift.prod_date.toISOString(),
            shiftCode: shift.shift_code,
            yieldPct,
            rejectionRatePct,
          };
        });
        break;

      case 'defects': {
        const entryIds = await fetchEntryIdsForShifts(shiftIds);
        if (entryIds.length > 0) {
          const rows = await reportingDb
            .selectFrom('txn.defect_entry as de')
            .innerJoin('master.defect_code as dc', 'de.defect_code', 'dc.defect_code')
            .innerJoin('master.process as p', 'de.process_id', 'p.process_id')
            .select([
              'de.defect_id as defectId',
              'p.code as lineId',
              'de.coil_no as coilNo',
              'de.defect_code as defectCode',
              'dc.description as defectName',
              'de.qty_mt as qtyMt',
              'de.location',
            ])
            .where('de.entry_id', 'in', entryIds)
            .orderBy('de.defect_id', 'desc')
            .execute();

          allRecords = rows.map((r) => ({
            defectId: String(r.defectId),
            lineId: r.lineId,
            coilNo: r.coilNo || '—',
            defectCode: r.defectCode,
            defectName: r.defectName || r.defectCode,
            qtyMt: round1(toNum(r.qtyMt)),
            location: r.location || '—',
          }));
        }
        break;
      }

      case 'downtime':
        if (shiftIds.length > 0) {
          const rows = await reportingDb
            .selectFrom('txn.stoppage_entry as se')
            .innerJoin('master.stoppage_code as sc', 'se.stoppage_code', 'sc.stoppage_code')
            .innerJoin('txn.shift_log as sl', 'se.shift_log_id', 'sl.shift_log_id')
            .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
            .select([
              'se.stoppage_id as stoppageId',
              'p.code as lineId',
              'sc.description as reason',
              'se.duration_min as durationMin',
              'sl.shift_code as shiftCode',
              'sl.prod_date as prodDate',
              'sc.is_planned as isPlanned',
            ])
            .where('se.shift_log_id', 'in', shiftIds)
            .orderBy('se.duration_min', 'desc')
            .execute();

          allRecords = rows.map((r) => ({
            stoppageId: String(r.stoppageId),
            lineId: r.lineId,
            reason: r.reason,
            durationMin: toNum(r.durationMin),
            shiftCode: r.shiftCode,
            prodDate: new Date(r.prodDate).toISOString(),
            type: r.isPlanned ? 'PLANNED' : 'UNPLANNED',
          }));
        }
        break;
    }

    return buildDrilldownEnvelope(metric, windowDays, allRecords, page);
  }

  static async getDrilldown(metric: string, scope: {
    processId?: string;
    dateFrom?: string;
    dateTo?: string;
    shiftCode?: string;
    coilNo?: string;
  }) {
    const from = scope.dateFrom ? new Date(scope.dateFrom) : new Date(Date.now() - 30 * DAY_MS);
    const to = scope.dateTo ? new Date(scope.dateTo) : new Date();
    const lines = scope.processId ? [scope.processId.toUpperCase()] : [];

    const shifts = await fetchShiftRows(lines, from, to);
    const filtered = scope.shiftCode
      ? shifts.filter((s) => s.shift_code === scope.shiftCode)
      : shifts;

    if (metric === 'downtime') {
      const shiftIds = filtered.map((s) => s.shift_log_id);
      if (shiftIds.length === 0) {
        return { metric, scope, entries: [], total: 0 };
      }

      let downtimeQuery = reportingDb
        .selectFrom('txn.stoppage_entry as se')
        .innerJoin('master.stoppage_code as sc', 'se.stoppage_code', 'sc.stoppage_code')
        .innerJoin('txn.shift_log as sl', 'se.shift_log_id', 'sl.shift_log_id')
        .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
        .select([
          'se.stoppage_id as id',
          'p.code as processId',
          'sl.shift_code as shiftCode',
          'sl.prod_date as date',
          'se.duration_min as value',
        ])
        .where('se.shift_log_id', 'in', shiftIds);

      if (scope.coilNo) {
        downtimeQuery = downtimeQuery.where('se.remarks', 'ilike', `%${scope.coilNo}%`);
      }

      const rows = await downtimeQuery.orderBy('se.duration_min', 'desc').limit(50).execute();

      const entries = rows.map((r) => ({
        id: String(r.id),
        coilNo: scope.coilNo || '—',
        processId: r.processId,
        shiftCode: r.shiftCode,
        date: new Date(r.date).toISOString(),
        value: toNum(r.value),
        unit: 'min',
      }));
      const total = entries.reduce((sum, e) => sum + e.value, 0);
      return { metric, scope, entries, total: round1(total) };
    }

    const entries = filtered.slice(0, 50).map((shift) => {
      let value = shift.total_prod_mt;
      if (metric === 'yield' || metric === 'rejection') {
        value = shift.target_mt > 0 ? calcPerformance(shift.total_prod_mt, shift.target_mt) : 0;
      } else if (metric === 'oee') {
        value = calcPerformance(shift.total_prod_mt, shift.target_mt);
      }
      return {
        id: shift.shift_log_id,
        coilNo: scope.coilNo || '—',
        processId: shift.lineId,
        shiftCode: shift.shift_code,
        date: shift.prod_date.toISOString(),
        value: round1(value),
        unit: metric === 'throughput' ? 'MT' : '%',
      };
    });

    const total = entries.reduce((sum, e) => sum + e.value, 0);
    return { metric, scope, entries, total: round1(total) };
  }

  static async searchCoilTraceability(coilNo: string) {
    const rows = await reportingDb
      .selectFrom('coil.coil as c')
      .leftJoin('master.process as p', 'c.current_process_id', 'p.process_id')
      .leftJoin('master.customer as cu', 'c.customer_id', 'cu.customer_id')
      .select([
        'c.coil_no as coilNo',
        'c.grade_code as grade',
        'cu.customer_name as customer',
        'p.code as currentProcess',
        'c.status',
        'c.weight_mt as weightMt',
      ])
      .where('c.coil_no', 'ilike', coilNo)
      .limit(1)
      .execute();

    if (rows.length === 0) {
      return { found: false, coilNo, genealogy: null };
    }

    const r = rows[0];
    const genealogy = {
      coilNo: r.coilNo,
      grade: r.grade || '—',
      customer: r.customer || '—',
      currentProcess: r.currentProcess || '—',
      status: r.status,
      weightMt: round1(toNum(r.weightMt)),
    };

    return { found: true, coilNo: r.coilNo, genealogy };
  }
}
