export interface PlantHeadKpiStrip {
  productionTodayMt: number;
  productionTodayTrendPct: number;
  oeePct: number;
  oeeTrendPct: number;
  availabilityPct: number;
  availabilityTrendPct: number;
  performancePct: number;
  performanceTrendPct: number;
  qualityPct: number;
  qualityTrendPct: number;
}

export interface PlantHeadDashboardPayload {
  window: number;
  generatedAt: string;
  plantWideOee: number;
  oeeTarget: number;
  oeeTrend: Array<{ date: string; oee: number }>;
  productionVsPlan: Array<{
    lineId: string;
    lineName: string;
    planned: number;
    actual: number;
    attainmentPct: number;
    throughput: number;
  }>;
  qualityTrend: Array<{ date: string; yieldPct: number; rejectionRatePct: number }>;
  topDefects: Array<{ defectCode: string; defectName: string; count: number; wowDelta: number }>;
  downtimeDrivers: Array<{
    reason: string;
    totalMinutes: number;
    occurrences: number;
    type: 'PLANNED' | 'UNPLANNED';
  }>;
  dailyProduction: Array<{ date: string; targetMt: number; actualMt: number }>;
  kpiStrip: PlantHeadKpiStrip;
}

function hasOneDecimal(value: number): boolean {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

function hasTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
}

export function validateDashboardPercentBounds(payload: PlantHeadDashboardPayload): boolean {
  if (payload.plantWideOee < 0 || payload.plantWideOee > 100 || !hasOneDecimal(payload.plantWideOee)) {
    return false;
  }
  for (const point of payload.qualityTrend) {
    if (point.yieldPct < 0 || point.yieldPct > 100) return false;
    if (point.rejectionRatePct < 0 || point.rejectionRatePct > 100) return false;
  }
  return true;
}

export function validateTopNOrdering(payload: PlantHeadDashboardPayload): boolean {
  if (payload.topDefects.length > 10) return false;
  for (let i = 1; i < payload.topDefects.length; i++) {
    if (payload.topDefects[i - 1].count < payload.topDefects[i].count) return false;
  }
  if (payload.downtimeDrivers.length > 10) return false;
  for (let i = 1; i < payload.downtimeDrivers.length; i++) {
    if (payload.downtimeDrivers[i - 1].totalMinutes < payload.downtimeDrivers[i].totalMinutes) {
      return false;
    }
  }
  return true;
}

export function validatePerLineCoverage(
  lineIds: string[],
  payload: PlantHeadDashboardPayload,
): boolean {
  const covered = new Set(payload.productionVsPlan.map((row) => row.lineId));
  if (lineIds.length === 0) {
    return payload.productionVsPlan.length === 0;
  }
  if (covered.size !== lineIds.length) return false;
  for (const lineId of lineIds) {
    if (!covered.has(lineId)) return false;
  }
  for (const row of payload.productionVsPlan) {
    if (!hasTwoDecimals(row.throughput)) return false;
  }
  return true;
}
