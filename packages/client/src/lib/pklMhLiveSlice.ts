import type { ProcessQueueCard } from '../store/processStore';

export type PklLiveTab =
  | 'overview'
  | 'orders'
  | 'production'
  | 'rejected'
  | 'stoppages'
  | 'completed';

export const PKL_LIVE_TABS: { id: PklLiveTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'production', label: 'Production' },
  { id: 'rejected', label: 'Order Hold' },
  { id: 'stoppages', label: 'Stoppage' },
  { id: 'completed', label: 'History' },
];

/** Tabs that show the order side panel (CRM MH layout). */
export const PKL_ORDER_TABS: PklLiveTab[] = [
  'orders',
  'production',
  'rejected',
  'completed',
];

export const PKL_QUEUE_TABS: PklLiveTab[] = ['orders', 'rejected', 'completed'];

const ORDER_STATUSES = new Set(['PENDING', 'PREPARING']);

export type PklChartRow = {
  chart_time: string;
  tank_no: number | null;
  tank_level: number | string | null;
  tank_temp_degc: number | string | null;
  acid_strength_pct: number | string | null;
  iron_strength_pct: number | string | null;
  steam_inlet_kgcm2?: number | string | null;
  steam_outlet_kgcm2?: number | string | null;
  steam_outlet_burner_kgcm2?: number | string | null;
  dosage_acid?: number | string | null;
  dosage_water?: number | string | null;
  dosage_inhibitor?: number | string | null;
  rinse_cl?: number | string | null;
  rinse_ph?: number | string | null;
  rinse_flow?: number | string | null;
  rinse_temp_degc?: number | string | null;
  rinse_acid_pct?: number | string | null;
  rinse_iron_pct?: number | string | null;
  burner_pressure_kgcm2?: number | string | null;
  hot_air_temp_degc?: number | string | null;
  line_incharge?: string | null;
  shiftCode?: string;
  intervalLabel?: string;
};

export type PklLineTableRow = {
  key: string;
  chartTime: string;
  shiftCode: string;
  intervalLabel: string;
  lineIncharge: string;
  steamInlet: string;
  steamOutlet: string;
  burnerPressure: string;
  hotAirTemp: string;
  dosageAcid: string;
  dosageWater: string;
  dosageInhibitor: string;
  rinseCl: string;
  rinsePh: string;
  rinseFlow: string;
  rinseTemp: string;
};

export type PklLineMetricGroup = 'steam' | 'dosage' | 'rinse';

export const PKL_LINE_METRIC_GROUPS: { id: PklLineMetricGroup; label: string }[] = [
  { id: 'steam', label: 'Steam / burner' },
  { id: 'dosage', label: 'Dosage' },
  { id: 'rinse', label: 'Hot rinse' },
];

export type PklTankTableRow = {
  key: string;
  chartTime: string;
  shiftCode: string;
  intervalLabel: string;
  level: string;
  temp: string;
  acid: string;
  iron: string;
};

export function slicePklQueue<T extends { status: string }>(queue: T[], tab: PklLiveTab): T[] {
  if (tab === 'orders') {
    return queue.filter((c) => ORDER_STATUSES.has(c.status.toUpperCase()));
  }
  if (tab === 'rejected') {
    const u = (s: string) => s.toUpperCase();
    return queue.filter((c) => u(c.status) === 'REJECTED' || u(c.status) === 'HOLD');
  }
  if (tab === 'completed') {
    return queue.filter((c) => c.status.toUpperCase() === 'COMPLETED');
  }
  return queue;
}

export function filterPklSearch<T extends {
  coilNo: string;
  motherCoilNo?: string;
  slitId?: string;
  gradeCode?: string;
  customerName?: string;
  batchNumber?: string;
}>(rows: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((c) =>
    [c.coilNo, c.motherCoilNo, c.slitId, c.gradeCode, c.customerName, c.batchNumber]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
}

export type PklLineStatus = 'RUNNING' | 'IDLE' | 'STOPPAGE';

export function pklLineStatus(
  queue: Array<{ status: string }>,
  stoppageActive: boolean,
): PklLineStatus {
  if (queue.some((c) => c.status === 'IN_PROGRESS')) return 'RUNNING';
  if (queue.some((c) => c.status === 'STOPPAGE') || stoppageActive) return 'STOPPAGE';
  return 'IDLE';
}

function chartNum(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function dispVal(v: unknown) {
  return v == null || v === '' ? '—' : String(v);
}

/** Keep rows for one tank (T1–T3). */
export function filterTankChartRows(rows: PklChartRow[], tankNo: 1 | 2 | 3): PklChartRow[] {
  return rows.filter((r) => Number(r.tank_no) === tankNo);
}

/** Map chart times to interval labels per shift (1st / 3rd / 5th / 7th). */
export function assignIntervalLabels(
  rows: PklChartRow[],
  labels: string[],
): PklChartRow[] {
  const byShift = new Map<string, Set<string>>();
  for (const r of rows) {
    const sc = r.shiftCode ?? '?';
    if (!byShift.has(sc)) byShift.set(sc, new Set());
    byShift.get(sc)!.add(String(r.chart_time));
  }
  const timeToLabel = new Map<string, string>();
  for (const [, times] of byShift) {
    const sorted = [...times].sort((a, b) => a.localeCompare(b));
    sorted.forEach((t, i) => timeToLabel.set(t, labels[i] ?? `${i + 1}`));
  }
  return rows.map((r) => ({
    ...r,
    intervalLabel: timeToLabel.get(String(r.chart_time)) ?? '—',
  }));
}

/** Table rows for selected tank, sorted shift → time. */
export function buildTankTableRows(rows: PklChartRow[], tankNo: 1 | 2 | 3): PklTankTableRow[] {
  return filterTankChartRows(rows, tankNo)
    .slice()
    .sort((a, b) => {
      const sc = String(a.shiftCode ?? '').localeCompare(String(b.shiftCode ?? ''));
      if (sc !== 0) return sc;
      return String(a.chart_time).localeCompare(String(b.chart_time));
    })
    .map((r) => ({
      key: `${r.shiftCode ?? ''}-${r.chart_time}-${r.tank_no}`,
      chartTime: String(r.chart_time),
      shiftCode: r.shiftCode ?? '—',
      intervalLabel: r.intervalLabel ?? '—',
      level: dispVal(r.tank_level),
      temp: dispVal(r.tank_temp_degc),
      acid: dispVal(r.acid_strength_pct),
      iron: dispVal(r.iron_strength_pct),
    }));
}

/** Single-tank recharts series — one point per reading time. */
export function buildTankChartData(rows: PklChartRow[], tankNo: 1 | 2 | 3) {
  const tankRows = filterTankChartRows(rows, tankNo)
    .slice()
    .sort((a, b) => String(a.chart_time).localeCompare(String(b.chart_time)));
  return tankRows.map((r) => ({
    time: String(r.intervalLabel && r.intervalLabel !== '—' ? r.intervalLabel : r.chart_time),
    temp: chartNum(r.tank_temp_degc),
    acid: chartNum(r.acid_strength_pct),
    iron: chartNum(r.iron_strength_pct),
    level: chartNum(r.tank_level),
  }));
}

/** Line-process rows — one per chart_time (tank_no = 1 carries line singletons). */
export function filterLineChartRows(rows: PklChartRow[]): PklChartRow[] {
  return rows.filter((r) => Number(r.tank_no) === 1);
}

/** Table rows for line process readings (operator chart capture). */
export function buildLineTableRows(rows: PklChartRow[]): PklLineTableRow[] {
  return filterLineChartRows(rows)
    .slice()
    .sort((a, b) => {
      const sc = String(a.shiftCode ?? '').localeCompare(String(b.shiftCode ?? ''));
      if (sc !== 0) return sc;
      return String(a.chart_time).localeCompare(String(b.chart_time));
    })
    .map((r) => ({
      key: `${r.shiftCode ?? ''}-${r.chart_time}`,
      chartTime: String(r.chart_time),
      shiftCode: r.shiftCode ?? '—',
      intervalLabel: r.intervalLabel ?? '—',
      lineIncharge: dispVal(r.line_incharge),
      steamInlet: dispVal(r.steam_inlet_kgcm2),
      steamOutlet: dispVal(r.steam_outlet_kgcm2),
      burnerPressure: dispVal(r.burner_pressure_kgcm2),
      hotAirTemp: dispVal(r.hot_air_temp_degc),
      dosageAcid: dispVal(r.dosage_acid),
      dosageWater: dispVal(r.dosage_water),
      dosageInhibitor: dispVal(r.dosage_inhibitor),
      rinseCl: dispVal(r.rinse_cl),
      rinsePh: dispVal(r.rinse_ph),
      rinseFlow: dispVal(r.rinse_flow),
      rinseTemp: dispVal(r.rinse_temp_degc),
    }));
}

const LINE_CHART_SERIES: Record<PklLineMetricGroup, Array<{ key: string; name: string; color: string }>> = {
  steam: [
    { key: 'steamIn', name: 'Steam in kg/cm²', color: '1' },
    { key: 'steamOut', name: 'Steam out kg/cm²', color: '4' },
    { key: 'burner', name: 'Burner kg/cm²', color: '2' },
    { key: 'hotAir', name: 'Hot air °C', color: '3' },
  ],
  dosage: [
    { key: 'dosageAcid', name: 'Acid L/min', color: '1' },
    { key: 'dosageWater', name: 'Water L/min', color: '4' },
    { key: 'dosageInhib', name: 'Inhibitor L/min', color: '2' },
  ],
  rinse: [
    { key: 'rinseCl', name: 'Cl', color: '1' },
    { key: 'rinsePh', name: 'pH', color: '4' },
    { key: 'rinseFlow', name: 'Flow', color: '2' },
    { key: 'rinseTemp', name: 'Temp °C', color: '3' },
  ],
};

/** Line-process recharts series — shares chart_time axis with tank readings. */
export function buildLineChartData(rows: PklChartRow[]) {
  const lineRows = filterLineChartRows(rows)
    .slice()
    .sort((a, b) => String(a.chart_time).localeCompare(String(b.chart_time)));
  return lineRows.map((r) => ({
    time: String(r.intervalLabel && r.intervalLabel !== '—' ? r.intervalLabel : r.chart_time),
    steamIn: chartNum(r.steam_inlet_kgcm2),
    steamOut: chartNum(r.steam_outlet_kgcm2),
    burner: chartNum(r.burner_pressure_kgcm2),
    hotAir: chartNum(r.hot_air_temp_degc),
    dosageAcid: chartNum(r.dosage_acid),
    dosageWater: chartNum(r.dosage_water),
    dosageInhib: chartNum(r.dosage_inhibitor),
    rinseCl: chartNum(r.rinse_cl),
    rinsePh: chartNum(r.rinse_ph),
    rinseFlow: chartNum(r.rinse_flow),
    rinseTemp: chartNum(r.rinse_temp_degc),
  }));
}

export function lineChartSeries(group: PklLineMetricGroup) {
  return LINE_CHART_SERIES[group];
}

export function queueCardSearchHay(card: ProcessQueueCard) {
  return [card.coilNo, card.motherCoilNo, card.slitId, card.gradeCode, card.batchNumber, card.customerName]
    .join(' ')
    .toLowerCase();
}
