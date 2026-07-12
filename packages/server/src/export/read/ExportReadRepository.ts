import { db } from '../../db';
import type {
  DispositionRow,
  DprStoppageCategory,
  ExportReadScope,
  ProcessRunRow,
  ProductionTargetRow,
  StoppageAgency,
  StoppageEventRow,
} from './types';
import {
  mapAnnCoilRow,
  mapCrm6OrderRow,
  mapCrsRow,
  mapCtlRow,
  mapHrsRow,
  mapPklRow,
  mapRwdRow,
} from './processMappers';
import { resolveCrm6AreaCode, resolveProcessArea, toDateString, toNumber } from './lineArea';

function parseScope(scope: ExportReadScope) {
  if (!scope.dateFrom || !scope.dateTo) {
    throw new Error('dateFrom and dateTo are required');
  }
  if (scope.dateTo < scope.dateFrom) {
    throw new Error('dateTo must be on or after dateFrom');
  }
  return scope;
}

function shiftMatches(scope: ExportReadScope, shiftCode: string): boolean {
  return !scope.shiftCode || scope.shiftCode === shiftCode;
}

function areaMatches(scope: ExportReadScope, areaCode: string): boolean {
  return !scope.areaCode || scope.areaCode === areaCode;
}

function monthRange(month: string): { dateFrom: string; dateTo: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    dateFrom: `${month}-01`,
    dateTo: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function scopeFromMonth(month: string, extra?: Partial<ExportReadScope>): ExportReadScope {
  const range = monthRange(month);
  return { ...range, ...extra };
}

type ShiftRow = {
  shift_log_id: string;
  prod_date: Date | string;
  shift_code: string;
  mill_type: string | null;
  process_code: string;
};

type ShiftCtx = ReturnType<typeof shiftCtx>;

async function fetchShiftLogs(scope: ExportReadScope): Promise<ShiftRow[]> {
  let q = db
    .selectFrom('txn.shift_log as sl')
    .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
    .select([
      'sl.shift_log_id',
      'sl.prod_date',
      'sl.shift_code',
      'sl.mill_type',
      'p.code as process_code',
    ])
    .where('sl.prod_date', '>=', new Date(scope.dateFrom))
    .where('sl.prod_date', '<=', new Date(scope.dateTo));

  if (scope.shiftCode) q = q.where('sl.shift_code', '=', scope.shiftCode);
  if (scope.processCode) q = q.where('p.code', '=', scope.processCode);

  const rows = await q.execute();
  return rows.map((r) => ({
    shift_log_id: String(r.shift_log_id),
    prod_date: r.prod_date,
    shift_code: r.shift_code,
    mill_type: r.mill_type,
    process_code: r.process_code,
  }));
}

function shiftCtx(row: ShiftRow) {
  return {
    shiftLogId: row.shift_log_id,
    prodDate: row.prod_date,
    shiftCode: row.shift_code,
    processCode: row.process_code,
    millType: row.mill_type,
  };
}

function groupShiftIdsByProcess(shifts: ShiftRow[]): Map<string, string[]> {
  const byProcess = new Map<string, string[]>();
  for (const shift of shifts) {
    const ids = byProcess.get(shift.process_code) ?? [];
    ids.push(shift.shift_log_id);
    byProcess.set(shift.process_code, ids);
  }
  return byProcess;
}

function pushMappedRuns(
  runs: ProcessRunRow[],
  scope: ExportReadScope,
  rows: Record<string, unknown>[],
  ctxByShiftId: Map<string, ShiftCtx>,
  mapper: (ctx: ShiftCtx, row: Record<string, unknown>) => ProcessRunRow,
) {
  for (const row of rows) {
    const ctx = ctxByShiftId.get(String(row.shift_log_id));
    if (!ctx) continue;
    const mapped = mapper(ctx, row);
    if (areaMatches(scope, mapped.areaCode)) runs.push(mapped);
  }
}

export class ExportReadRepository {
  static async fetchRuns(scopeInput: ExportReadScope): Promise<ProcessRunRow[]> {
    const scope = parseScope(scopeInput);
    const shifts = await fetchShiftLogs(scope);
    if (shifts.length === 0) return [];

    const ctxByShiftId = new Map(shifts.map((s) => [s.shift_log_id, shiftCtx(s)]));
    const shiftIdsByProcess = groupShiftIdsByProcess(shifts);
    const runs: ProcessRunRow[] = [];

    const hrsIds = shiftIdsByProcess.get('HRS') ?? [];
    if (hrsIds.length > 0) {
      let q = db.selectFrom('txn.prod_hrs').selectAll().where('shift_log_id', 'in', hrsIds);
      if (scope.coilNo) q = q.where('coil_no', '=', scope.coilNo);
      pushMappedRuns(runs, scope, await q.execute() as Record<string, unknown>[], ctxByShiftId, mapHrsRow);
    }

    const pklIds = shiftIdsByProcess.get('PKL') ?? [];
    if (pklIds.length > 0) {
      let q = db.selectFrom('txn.prod_pkl').selectAll().where('shift_log_id', 'in', pklIds);
      if (scope.coilNo) q = q.where('coil_no', '=', scope.coilNo);
      pushMappedRuns(runs, scope, await q.execute() as Record<string, unknown>[], ctxByShiftId, mapPklRow);
    }

    const annIds = shiftIdsByProcess.get('ANN') ?? [];
    if (annIds.length > 0) {
      const charges = await db
        .selectFrom('txn.ann_charge')
        .selectAll()
        .where('shift_log_id', 'in', annIds)
        .execute();

      if (charges.length > 0) {
        const chargeNos = charges.map((c) => c.charge_no);
        let coilQ = db
          .selectFrom('txn.ann_charge_coil')
          .select(['charge_no', 'coil_no'])
          .where('charge_no', 'in', chargeNos);
        if (scope.coilNo) coilQ = coilQ.where('coil_no', '=', scope.coilNo);
        const coils = await coilQ.execute();

        const coilsByCharge = new Map<string, string[]>();
        for (const { charge_no, coil_no } of coils) {
          const bucket = coilsByCharge.get(charge_no);
          if (bucket) bucket.push(coil_no);
          else coilsByCharge.set(charge_no, [coil_no]);
        }

        for (const charge of charges) {
          const ctx = ctxByShiftId.get(String(charge.shift_log_id));
          if (!ctx) continue;
          for (const coilNo of coilsByCharge.get(charge.charge_no) ?? []) {
            const mapped = mapAnnCoilRow(ctx, coilNo, charge as Record<string, unknown>);
            if (areaMatches(scope, mapped.areaCode)) runs.push(mapped);
          }
        }
      }
    }



    const rwdIds = shiftIdsByProcess.get('RWD') ?? [];
    if (rwdIds.length > 0) {
      let q = db.selectFrom('txn.prod_rwd').selectAll().where('shift_log_id', 'in', rwdIds);
      if (scope.coilNo) q = q.where('coil_no', '=', scope.coilNo);
      pushMappedRuns(runs, scope, await q.execute() as Record<string, unknown>[], ctxByShiftId, mapRwdRow);
    }

    const crsIds = shiftIdsByProcess.get('CRS') ?? [];
    if (crsIds.length > 0) {
      let q = db.selectFrom('txn.prod_crs').selectAll().where('shift_log_id', 'in', crsIds);
      if (scope.coilNo) q = q.where('coil_no', '=', scope.coilNo);
      pushMappedRuns(runs, scope, await q.execute() as Record<string, unknown>[], ctxByShiftId, mapCrsRow);
    }

    const ctlIds = shiftIdsByProcess.get('CTL') ?? [];
    if (ctlIds.length > 0) {
      let q = db.selectFrom('txn.prod_ctl').selectAll().where('shift_log_id', 'in', ctlIds);
      if (scope.coilNo) q = q.where('coil_no', '=', scope.coilNo);
      pushMappedRuns(runs, scope, await q.execute() as Record<string, unknown>[], ctxByShiftId, mapCtlRow);
    }

    const sixHiIds = shiftIdsByProcess.get('6HI') ?? [];
    if (sixHiIds.length > 0) {
      let orderQ = db
        .selectFrom('txn.crm6_order as o')
        .leftJoin('planning.ppc_batch as pb', 'o.batch_id', 'pb.batch_id')
        .select([
          'o.order_id',
          'o.coil_no',
          'o.batch_number',
          'o.sub_process',
          'o.ppc_weight_mt',
          'o.ppc_thk_mm',
          'o.production_day',
          'o.grade_code',
          'o.shift_log_id',
          'pb.machine_code',
        ])
        .where('o.shift_log_id', 'in', sixHiIds);

      if (scope.coilNo) orderQ = orderQ.where('o.coil_no', '=', scope.coilNo);

      const orders = await orderQ.execute();
      if (orders.length > 0) {
        const orderIds = orders.map((o) => String(o.order_id));
        const [rollingRows, skinpassRows] = await Promise.all([
          db.selectFrom('txn.crm6_rolling').selectAll().where('order_id', 'in', orderIds).execute(),
          db.selectFrom('txn.crm6_skinpass').selectAll().where('order_id', 'in', orderIds).execute(),
        ]);

        const rollingByOrder = new Map(rollingRows.map((r) => [String(r.order_id), r]));
        const skinpassByOrder = new Map(skinpassRows.map((r) => [String(r.order_id), r]));

        for (const order of orders) {
          const ctx = ctxByShiftId.get(String(order.shift_log_id));
          if (!ctx) continue;
          const orderId = String(order.order_id);
          const machineCode = order.machine_code ?? '6HI';
          const mapped = mapCrm6OrderRow(
            ctx,
            order as Record<string, unknown>,
            machineCode,
            (rollingByOrder.get(orderId) ?? null) as Record<string, unknown> | null,
            (skinpassByOrder.get(orderId) ?? null) as Record<string, unknown> | null,
          );
          if (areaMatches(scope, mapped.areaCode)) runs.push(mapped);
        }
      }
    }

    return runs;
  }

  static async fetchStoppages(scopeInput: ExportReadScope): Promise<StoppageEventRow[]> {
    const scope = parseScope(scopeInput);
    const events: StoppageEventRow[] = [];

    let shiftQ = db
      .selectFrom('txn.shift_log as sl')
      .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
      .select(['sl.shift_log_id', 'sl.prod_date', 'sl.shift_code', 'sl.mill_type', 'p.code as process_code'])
      .where('sl.prod_date', '>=', new Date(scope.dateFrom))
      .where('sl.prod_date', '<=', new Date(scope.dateTo));

    if (scope.shiftCode) shiftQ = shiftQ.where('sl.shift_code', '=', scope.shiftCode);
    if (scope.processCode) shiftQ = shiftQ.where('p.code', '=', scope.processCode);

    const shifts = await shiftQ.execute();
    const eligibleShifts = shifts.filter((shift) => {
      const areaCode = resolveProcessArea(shift.process_code, shift.mill_type);
      return areaMatches(scope, areaCode) && shiftMatches(scope, shift.shift_code);
    });

    const shiftIds = eligibleShifts.map((s) => String(s.shift_log_id));
    const shiftById = new Map(
      eligibleShifts.map((s) => [String(s.shift_log_id), s]),
    );

    if (shiftIds.length > 0) {
      const entries = await db
        .selectFrom('txn.stoppage as se')
        .innerJoin('master.stoppage_code as sc', 'se.breakdown_code', 'sc.stoppage_code')
        .select([
          'se.stoppage_id',
          'se.shift_log_id',
          'se.duration_min',
          'se.remarks',
          'se.breakdown_code as stoppage_code',
          'sc.description',
          'sc.dpr_category',
          'sc.agency_code',
          'sc.category',
        ])
        .where('se.shift_log_id', 'in', shiftIds)
        .execute();

      for (const e of entries) {
        const shift = shiftById.get(String(e.shift_log_id));
        if (!shift) continue;
        const areaCode = resolveProcessArea(shift.process_code, shift.mill_type);
        events.push({
          eventId: `shift:${e.stoppage_id}`,
          areaCode,
          prodDate: toDateString(shift.prod_date),
          shiftCode: shift.shift_code,
          minutes: e.duration_min ?? 0,
          agencyCode: (e.agency_code ?? mapLegacyAgency(e.category)) as StoppageAgency,
          reasonCode: e.stoppage_code ?? '',
          reasonLabel: e.description,
          dprCategory: (e.dpr_category ?? mapLegacyDprCategory(e.category)) as DprStoppageCategory,
          remark: e.remarks,
        });
      }
    }

    // CRM6 order-level stoppages.
    // Shift/day attribution is derived from the order's shift_log (the single source of
    // truth used everywhere else, incl. re-attributed backlog orders) rather than from a
    // hardcoded shift. For a monthly DPR (scope.shiftCode undefined) this keeps each
    // stoppage in its actual shift column instead of collapsing them all into shift A.
    let orderQ = db
      .selectFrom('txn.stoppage as os')
      .innerJoin('txn.crm6_order as o', 'os.order_id', 'o.order_id')
      .leftJoin('planning.ppc_batch as pb', 'o.batch_id', 'pb.batch_id')
      .leftJoin('txn.shift_log as osl', 'o.shift_log_id', 'osl.shift_log_id')
      .innerJoin('master.stoppage_category as sc', 'os.category_code', 'sc.category_code')
      .leftJoin('master.stoppage_code as bc', 'os.breakdown_code', 'bc.stoppage_code')
      .select([
        'os.stoppage_id',
        'os.duration_min',
        'os.remarks',
        'os.category_code',
        'o.coil_no',
        'o.sub_process',
        'o.production_day',
        'pb.machine_code',
        'osl.shift_code as shift_log_shift_code',
        'osl.prod_date as shift_log_prod_date',
        'sc.label',
        'sc.dpr_category',
        'sc.agency_code',
        'bc.stoppage_code as breakdown_code',
        'bc.description as breakdown_label',
        'bc.dpr_category as breakdown_dpr_category',
        'bc.agency_code as breakdown_agency',
      ])
      .where('o.production_day', '>=', new Date(scope.dateFrom))
      .where('o.production_day', '<=', new Date(scope.dateTo));

    if (scope.coilNo) orderQ = orderQ.where('o.coil_no', '=', scope.coilNo);

    const orderStops = await orderQ.execute();
    for (const s of orderStops) {
      const machineCode = s.machine_code ?? '6HI';
      const areaCode = resolveCrm6AreaCode(machineCode, s.sub_process, false);
      if (!areaMatches(scope, areaCode)) continue;

      const shiftCode = s.shift_log_shift_code ?? scope.shiftCode ?? 'A';
      if (!shiftMatches(scope, shiftCode)) continue;

      const dateSource = s.shift_log_prod_date ?? s.production_day;
      const prodDate = dateSource ? toDateString(dateSource) : scope.dateFrom;
      events.push({
        eventId: `order:${s.stoppage_id}`,
        areaCode,
        prodDate,
        shiftCode,
        minutes: s.duration_min ?? 0,
        agencyCode: (s.breakdown_agency ?? s.agency_code ?? 'OP') as StoppageAgency,
        reasonCode: s.breakdown_code ?? s.category_code,
        reasonLabel: s.breakdown_label ?? s.label,
        dprCategory: (s.breakdown_dpr_category ?? s.dpr_category ?? 'OPERATIONAL') as DprStoppageCategory,
        remark: s.remarks,
      });
    }

    return events;
  }

  static async fetchDisposition(scopeInput: ExportReadScope): Promise<DispositionRow[]> {
    const runs = await this.fetchRuns(scopeInput);
    const rows: DispositionRow[] = [];

    for (const run of runs) {
      const attrs = run.attrs ?? {};
      let scrapMt = 0;
      let internalRejMt = 0;
      const bSlitMt = 0;
      const trimMt = 0;

      if (run.processCode === 'HRS') {
        scrapMt = toNumber(attrs.scrap_mt) ?? 0;
      } else if (run.processCode === 'SKP') {
        scrapMt = toNumber(attrs.wt_scrap_mt) ?? 0;
      } else if (run.processCode === 'CRS') {
        internalRejMt = run.status === 'REJECT' ? (run.outputWeightMt ?? 0) : 0;
      } else if (run.processCode === 'CTL') {
        internalRejMt = run.status === 'REJECT' ? (run.outputWeightMt ?? 0) : 0;
      }

      if (scrapMt > 0 || internalRejMt > 0 || bSlitMt > 0 || trimMt > 0 || run.status !== 'OK') {
        rows.push({
          areaCode: run.areaCode,
          prodDate: run.prodDate,
          shiftCode: run.shiftCode,
          coilNo: run.coilNo,
          scrapMt,
          internalRejMt,
          bSlitMt,
          trimMt,
        });
      }
    }

    return rows;
  }

  static async fetchTargets(month: string): Promise<ProductionTargetRow[]> {
    const { dateFrom, dateTo } = monthRange(month);
    const rows = await db
      .selectFrom('planning.production_target')
      .select(['area_code', 'period', 'target_mt', 'target_rate'])
      .where('period', '>=', new Date(dateFrom))
      .where('period', '<=', new Date(dateTo))
      .orderBy('area_code')
      .execute();

    return rows.map((r) => ({
      areaCode: r.area_code,
      period: toDateString(r.period),
      targetMt: toNumber(r.target_mt),
      targetRate: toNumber(r.target_rate),
    }));
  }
}

function mapLegacyAgency(category: string): StoppageAgency {
  if (category === 'ELECT' || category === 'POWER') return 'EL';
  if (category === 'MECH') return 'MECH';
  return 'OP';
}

function mapLegacyDprCategory(category: string): DprStoppageCategory {
  const map: Record<string, DprStoppageCategory> = {
    ELECT: 'ELECTRICAL',
    MECH: 'MECHANICAL',
    OPN: 'OPERATIONAL',
    UTILITY: 'EQUIPMENT_AVAILABILITY',
    POWER: 'POWER_FAILURE',
    PLANNED: 'PREVENTIVE_MAINTENANCE',
  };
  return map[category] ?? 'OPERATIONAL';
}
