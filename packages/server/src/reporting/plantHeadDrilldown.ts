export const DRILLDOWN_PAGE_SIZE = 500;

export const PLANT_HEAD_DRILLDOWN_METRICS = [
  'oee',
  'production',
  'defects',
  'downtime',
  'quality',
] as const;

export type PlantHeadDrilldownMetric = (typeof PLANT_HEAD_DRILLDOWN_METRICS)[number];

export type DrilldownMetricParseResult =
  | { ok: true; metric: PlantHeadDrilldownMetric }
  | { ok: false; error: 'MISSING_METRIC' | 'INVALID_METRIC'; value?: string };

export interface DrilldownEnvelope {
  metric: PlantHeadDrilldownMetric;
  window: number;
  records: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export function parsePlantHeadDrilldownMetric(raw: unknown): DrilldownMetricParseResult {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, error: 'MISSING_METRIC' };
  }
  const value = String(raw).trim();
  const normalized = value.toLowerCase();
  if ((PLANT_HEAD_DRILLDOWN_METRICS as readonly string[]).includes(normalized)) {
    return { ok: true, metric: normalized as PlantHeadDrilldownMetric };
  }
  return { ok: false, error: 'INVALID_METRIC', value };
}

export function parseDrilldownPage(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return 1;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    return 1;
  }
  return n;
}

export function paginateRecords<T>(
  records: T[],
  page: number,
  pageSize = DRILLDOWN_PAGE_SIZE,
): { records: T[]; total: number; page: number; pageSize: number } {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const offset = (safePage - 1) * pageSize;
  return {
    records: records.slice(offset, offset + pageSize),
    total: records.length,
    page: safePage,
    pageSize,
  };
}

export function buildDrilldownEnvelope(
  metric: PlantHeadDrilldownMetric,
  windowDays: number,
  allRecords: Record<string, unknown>[],
  page: number,
): DrilldownEnvelope {
  const sliced = paginateRecords(allRecords, page);
  return {
    metric,
    window: windowDays,
    records: sliced.records,
    total: sliced.total,
    page: sliced.page,
    pageSize: sliced.pageSize,
  };
}

export function validatePaginationPartition<T>(allRecords: T[], pageSize: number): boolean {
  if (pageSize <= 0) return false;
  const pages = Math.ceil(allRecords.length / pageSize) || 1;
  const slices: T[][] = [];
  for (let page = 1; page <= pages; page++) {
    const { records } = paginateRecords(allRecords, page, pageSize);
    if (records.length > pageSize) return false;
    slices.push(records);
  }
  const merged = slices.flat();
  if (merged.length !== allRecords.length) return false;
  for (let i = 0; i < allRecords.length; i++) {
    if (merged[i] !== allRecords[i]) return false;
  }
  return true;
}
