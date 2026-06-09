/** Report Data Model shapes — format-agnostic output of aggregation (§5). */

export type ShiftCode = 'A' | 'B' | 'C';

/** Per-shift numeric triple used across DPR regions. */
export interface ShiftTriple {
  A: number;
  B: number;
  C: number;
  total: number;
}

export interface ShiftTripleDerived extends ShiftTriple {
  cum: number;
}

export interface UtilisationPct {
  today: number;
  cum: number;
}

export interface ProdRateBlock {
  A: number;
  B: number;
  C: number;
  today: number;
  cum: number;
  target: number;
}

export interface DispositionShiftBlock {
  A: number;
  B: number;
  C: number;
  total: number;
  cum: number;
  pct: number;
}

/** Stoppage minutes — per-shift for main categories; day-scalar for others. */
export interface StoppageMinBlock {
  electrical: ShiftTriple;
  mechanical: ShiftTriple;
  operational: ShiftTriple;
  equipment_availability: ShiftTriple;
  prev_maint: number;
  power_failure: number;
  no_plan: number;
  rm_shortage: number;
}

export interface DprAreaDayBlock {
  areaCode: string;
  areaLabel: string;
  operatingMinutesBase: number;
  targetMt: number;
  prod: ShiftTriple;
  cumMt: number;
  avgMt: number;
  stoppageMin: StoppageMinBlock;
  equipAvailMin: ShiftTripleDerived;
  utilisationPct: UtilisationPct;
  prodRate: ProdRateBlock;
  scrap: DispositionShiftBlock;
  internalRej: DispositionShiftBlock;
  bSlit: DispositionShiftBlock;
  trim: DispositionShiftBlock;
}

export interface WrChangeRollup {
  nos: number;
  min: number;
}

export interface DprDayRollups {
  despatchMt: number;
  yieldPct: number;
  wrChange: {
    '4hi': WrChangeRollup;
    '6hi': WrChangeRollup;
    '2hi': WrChangeRollup;
  };
  fgBalanceMt: number;
}

export interface DprDayBlock {
  date: string;
  dayIndex: number;
  areas: DprAreaDayBlock[];
  rollups: DprDayRollups;
}

export interface DelayLogEntry {
  date: string;
  areaLabel: string;
  shift: ShiftCode | string;
  minutes: number | null;
  agency: string;
  reason: string;
  isNil?: boolean;
}

export interface DprRdm {
  report: 'DPR';
  month: string;
  days: DprDayBlock[];
  delayLog: DelayLogEntry[];
}

/** E3 coil trace RDM (§5.2) — types only in Phase 2; aggregation in Phase 6. */
export interface CoilTraceTimelineStep {
  seq: number;
  process: string;
  date: string;
  shift: string;
  operator: string | null;
  keyValues: Record<string, unknown>;
  quality: { defects: string[] };
  status: string;
  chargeNo?: string;
  baseNo?: string;
}

export interface CoilTraceRdm {
  report: 'COIL_TRACE';
  coilNo: string;
  header: {
    grade: string | null;
    customer: string | null;
    sourceCoilNo: string | null;
    forCtlFlag: boolean;
  };
  timeline: CoilTraceTimelineStep[];
}
