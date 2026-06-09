import type {
  DispositionShiftBlock,
  DprAreaDayBlock,
  DprDayBlock,
  DprDayRollups,
  DprRdm,
  ShiftCode,
  ShiftTriple,
  StoppageMinBlock,
} from '../types/rdm';
import type {
  DispositionRow,
  DprStoppageCategory,
  ProcessRunRow,
  ProductionTargetRow,
  StoppageEventRow,
} from '../read/types';
import { DPR_LINE_AREAS, type LineAreaDef } from './lineAreas';
import { buildDelayLog } from './delaySheet';
import {
  SHIFTS,
  addToShift,
  chainCumMt,
  computeAvgMt,
  computeDispositionPct,
  computeEquipAvailMin,
  computeProdRate,
  computeTotal,
  computeUtilisationPct,
  computeYieldPct,
  emptyShiftTriple,
  finalizeShiftTriple,
  round2,
  timeRangeMinutes,
} from './derivation';

export interface DprAggregatorInput {
  month: string;
  runs: ProcessRunRow[];
  stoppages: StoppageEventRow[];
  dispositions: DispositionRow[];
  targets: ProductionTargetRow[];
  lineAreas?: LineAreaDef[];
}

interface CapturedAreaDay {
  prod: ShiftTriple;
  stoppage: StoppageMinBlock;
  scrap: ShiftTriple;
  internalRej: ShiftTriple;
  bSlit: ShiftTriple;
  trim: ShiftTriple;
  runningMinutes: Record<ShiftCode, number>;
  targetMt: number;
  targetRate: number;
}

const CATEGORY_TO_SHIFT_KEY: Record<
  DprStoppageCategory,
  keyof Pick<StoppageMinBlock, 'electrical' | 'mechanical' | 'operational' | 'equipment_availability'> | 'scalar'
> = {
  ELECTRICAL: 'electrical',
  MECHANICAL: 'mechanical',
  OPERATIONAL: 'operational',
  EQUIPMENT_AVAILABILITY: 'equipment_availability',
  PREVENTIVE_MAINTENANCE: 'scalar',
  POWER_FAILURE: 'scalar',
  NO_PLAN: 'scalar',
  RM_SHORTAGE: 'scalar',
};

const SCALAR_FIELD: Record<string, keyof Pick<StoppageMinBlock, 'prev_maint' | 'power_failure' | 'no_plan' | 'rm_shortage'>> = {
  PREVENTIVE_MAINTENANCE: 'prev_maint',
  POWER_FAILURE: 'power_failure',
  NO_PLAN: 'no_plan',
  RM_SHORTAGE: 'rm_shortage',
};

const WR_AREA_PREFIX: Record<string, keyof DprDayRollups['wrChange']> = {
  '4HI': '4hi',
  '6HI': '6hi',
  '2HI': '2hi',
};

export class DprAggregator {
  static aggregate(input: DprAggregatorInput): DprRdm {
    const areas = input.lineAreas ?? DPR_LINE_AREAS;
    const dates = daysInMonth(input.month);
    const priorCumByArea = new Map<string, number>();
    const priorEquipCumByArea = new Map<string, number>();
    const priorProdCumByArea = new Map<string, number>();
    const priorRunningCumByArea = new Map<string, number>();
    const priorScrapCumByArea = new Map<string, number>();
    const priorRejCumByArea = new Map<string, number>();
    let fgBalanceRunning = 0;

    const days: DprDayBlock[] = dates.map((date, idx) => {
      const dayIndex = idx + 1;
      const captured = captureDay(input, date, areas);
      const areaBlocks: DprAreaDayBlock[] = [];

      for (const area of areas) {
        if (!area.isDprReported) continue;
        const c = captured.get(area.areaCode) ?? emptyCaptured();
        const prod = computeTotal(c.prod);
        const priorCum = priorCumByArea.get(area.areaCode) ?? 0;
        const cumMt = round2(priorCum + prod.total);
        priorCumByArea.set(area.areaCode, cumMt);

        const stoppageByShift = stoppageMinutesPerShift(c.stoppage);
        const equipAvailMin = computeEquipAvailMin(area.operatingMinutesBase, stoppageByShift);
        const priorEquipCum = priorEquipCumByArea.get(area.areaCode) ?? 0;
        const equipCum = round2(priorEquipCum + equipAvailMin.cum);
        priorEquipCumByArea.set(area.areaCode, equipCum);

        const utilisationPct = computeUtilisationPct(
          equipAvailMin.cum,
          equipCum,
          area.operatingMinutesBase,
          dayIndex,
        );

        const running = resolveRunningMinutes(c.runningMinutes, equipAvailMin);
        const priorProdCum = priorProdCumByArea.get(area.areaCode) ?? 0;
        const priorRunningCum = priorRunningCumByArea.get(area.areaCode) ?? 0;
        const prodRate = computeProdRate(
          prod,
          running,
          c.targetRate,
          priorProdCum,
          priorRunningCum,
        );
        priorProdCumByArea.set(area.areaCode, priorProdCum + prod.total);
        priorRunningCumByArea.set(
          area.areaCode,
          priorRunningCum + running.A + running.B + running.C,
        );

        areaBlocks.push({
          areaCode: area.areaCode,
          areaLabel: area.areaLabel,
          operatingMinutesBase: area.operatingMinutesBase,
          targetMt: c.targetMt,
          prod,
          cumMt,
          avgMt: computeAvgMt(cumMt, dayIndex),
          stoppageMin: c.stoppage,
          equipAvailMin,
          utilisationPct,
          prodRate,
          scrap: finalizeDisposition(c.scrap, prod.total, priorScrapCumByArea, area.areaCode),
          internalRej: finalizeDisposition(c.internalRej, prod.total, priorRejCumByArea, area.areaCode),
          bSlit: finalizeDispositionBlock(c.bSlit, prod.total),
          trim: finalizeDispositionBlock(c.trim, prod.total),
        });
      }

      const rollups = computeDayRollups(input, date, fgBalanceRunning);
      fgBalanceRunning = rollups.fgBalanceMt;

      return { date, dayIndex, areas: areaBlocks, rollups };
    });

    const delayLog = buildDelayLog(input.stoppages, dates);

    return { report: 'DPR', month: input.month, days, delayLog };
  }
}

function captureDay(
  input: DprAggregatorInput,
  date: string,
  areas: LineAreaDef[],
): Map<string, CapturedAreaDay> {
  const map = new Map<string, CapturedAreaDay>();
  const ensure = (code: string) => {
    if (!map.has(code)) map.set(code, emptyCaptured());
    return map.get(code)!;
  };

  for (const area of areas) {
    const t = input.targets.find((x) => x.areaCode === area.areaCode && x.period === date);
    const c = ensure(area.areaCode);
    if (t?.targetMt != null) c.targetMt = t.targetMt;
    if (t?.targetRate != null) c.targetRate = t.targetRate;
  }

  for (const run of input.runs) {
    if (run.prodDate !== date) continue;
    const c = ensure(run.areaCode);
    addToShift(c.prod, run.shiftCode, run.outputWeightMt ?? 0);
    const mins = timeRangeMinutes(run.timeFrom, run.timeTo);
    if (mins > 0 && isShift(run.shiftCode)) {
      c.runningMinutes[run.shiftCode] = round2(c.runningMinutes[run.shiftCode] + mins);
    }
  }

  for (const stop of input.stoppages) {
    if (stop.prodDate !== date) continue;
    const c = ensure(stop.areaCode);
    applyStoppage(c.stoppage, stop);
  }

  for (const disp of input.dispositions) {
    if (disp.prodDate !== date) continue;
    const c = ensure(disp.areaCode);
    addToShift(c.scrap, disp.shiftCode, disp.scrapMt);
    addToShift(c.internalRej, disp.shiftCode, disp.internalRejMt);
    addToShift(c.bSlit, disp.shiftCode, disp.bSlitMt);
    addToShift(c.trim, disp.shiftCode, disp.trimMt);
  }

  for (const [, c] of map) {
    c.prod = finalizeShiftTriple(c.prod);
    c.scrap = finalizeShiftTriple(c.scrap);
    c.internalRej = finalizeShiftTriple(c.internalRej);
    c.bSlit = finalizeShiftTriple(c.bSlit);
    c.trim = finalizeShiftTriple(c.trim);
  }

  return map;
}

function applyStoppage(block: StoppageMinBlock, e: StoppageEventRow): void {
  const key = CATEGORY_TO_SHIFT_KEY[e.dprCategory];
  if (key === 'scalar') {
    const field = SCALAR_FIELD[e.dprCategory];
    if (field) block[field] = round2(block[field] + e.minutes);
    return;
  }
  addToShift(block[key], e.shiftCode, e.minutes);
}

function stoppageMinutesPerShift(block: StoppageMinBlock): Record<ShiftCode, number> {
  const sumShift = (t: ShiftTriple) => t.A + t.B + t.C;
  return {
    A: round2(
      block.electrical.A +
        block.mechanical.A +
        block.operational.A +
        block.equipment_availability.A,
    ),
    B: round2(
      block.electrical.B +
        block.mechanical.B +
        block.operational.B +
        block.equipment_availability.B,
    ),
    C: round2(
      block.electrical.C +
        block.mechanical.C +
        block.operational.C +
        block.equipment_availability.C,
    ),
  };
}

function resolveRunningMinutes(
  captured: Record<ShiftCode, number>,
  equip: { A: number; B: number; C: number },
): Record<ShiftCode, number> {
  return {
    A: captured.A > 0 ? captured.A : equip.A,
    B: captured.B > 0 ? captured.B : equip.B,
    C: captured.C > 0 ? captured.C : equip.C,
  };
}

function finalizeDisposition(
  amounts: ShiftTriple,
  totalProd: number,
  priorMap: Map<string, number>,
  areaCode: string,
): DispositionShiftBlock {
  const prior = priorMap.get(areaCode) ?? 0;
  const cum = round2(prior + amounts.total);
  priorMap.set(areaCode, cum);
  return { ...amounts, cum, pct: computeDispositionPct(amounts.total, totalProd) };
}

function finalizeDispositionBlock(
  amounts: ShiftTriple,
  totalProd: number,
): DispositionShiftBlock {
  return { ...amounts, cum: amounts.total, pct: computeDispositionPct(amounts.total, totalProd) };
}

function computeDayRollups(
  input: DprAggregatorInput,
  date: string,
  priorFgBalance: number,
): DprDayRollups {
  const dayRuns = input.runs.filter((r) => r.prodDate === date);
  const dayStops = input.stoppages.filter((s) => s.prodDate === date);

  const hrsInput = sumArea(dayRuns, 'HRS');
  const ctlOutput = sumAreas(dayRuns, (c) => c.startsWith('CTL_'));
  const pkgOutput = sumArea(dayRuns, 'PKG');
  const despatchMt = round2(pkgOutput || ctlOutput);

  const wrChange = { '4hi': { nos: 0, min: 0 }, '6hi': { nos: 0, min: 0 }, '2hi': { nos: 0, min: 0 } };
  for (const s of dayStops) {
    const prefix = s.areaCode.split('_')[0];
    const bucket = WR_AREA_PREFIX[prefix];
    if (!bucket) continue;
    const code = s.reasonCode.toUpperCase();
    const isWr =
      code === 'WR_CHANGE' ||
      code.includes('WR_CHANGE') ||
      s.reasonLabel.toUpperCase().includes('W/R CHANGE');
    if (isWr) {
      wrChange[bucket].nos += 1;
      wrChange[bucket].min = round2(wrChange[bucket].min + s.minutes);
    }
  }

  const fgBalanceMt = round2(priorFgBalance + ctlOutput + pkgOutput - despatchMt);

  return {
    despatchMt,
    yieldPct: computeYieldPct(ctlOutput + pkgOutput, hrsInput),
    wrChange,
    fgBalanceMt,
  };
}

function sumArea(runs: ProcessRunRow[], areaCode: string): number {
  return round2(
    runs.filter((r) => r.areaCode === areaCode).reduce((s, r) => s + (r.outputWeightMt ?? 0), 0),
  );
}

function sumAreas(runs: ProcessRunRow[], pred: (code: string) => boolean): number {
  return round2(
    runs.filter((r) => pred(r.areaCode)).reduce((s, r) => s + (r.outputWeightMt ?? 0), 0),
  );
}

function emptyCaptured(): CapturedAreaDay {
  return {
    prod: emptyShiftTriple(),
    stoppage: emptyStoppageBlock(),
    scrap: emptyShiftTriple(),
    internalRej: emptyShiftTriple(),
    bSlit: emptyShiftTriple(),
    trim: emptyShiftTriple(),
    runningMinutes: { A: 0, B: 0, C: 0 },
    targetMt: 0,
    targetRate: 0,
  };
}

function emptyStoppageBlock(): StoppageMinBlock {
  return {
    electrical: emptyShiftTriple(),
    mechanical: emptyShiftTriple(),
    operational: emptyShiftTriple(),
    equipment_availability: emptyShiftTriple(),
    prev_maint: 0,
    power_failure: 0,
    no_plan: 0,
    rm_shortage: 0,
  };
}

function daysInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => {
    const d = i + 1;
    return `${month}-${String(d).padStart(2, '0')}`;
  });
}

function isShift(s: string): s is ShiftCode {
  return s === 'A' || s === 'B' || s === 'C';
}
