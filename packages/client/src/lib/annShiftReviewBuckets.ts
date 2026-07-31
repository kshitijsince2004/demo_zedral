/** Soft map ANN stoppage categories → delay summary buckets. */
const BUCKET_BY_CODE: Record<string, string> = {
  BASE_FAN: 'Base / mechanical',
  BASE_SEAL: 'Base / mechanical',
  BASE_CLAMP: 'Base / mechanical',
  BASE_WATER: 'Base / mechanical',
  CA_BLOWER: 'Base / mechanical',
  THERMOCOUPLE: 'Instrumentation',
  POWER: 'Power',
  GAS_SUPPLY: 'Utilities',
  CRANE: 'Material handling',
  OTHER: 'Other',
};

export function annStoppageDelayBucket(categoryCode: string | null | undefined): string {
  if (!categoryCode) return 'Other';
  return BUCKET_BY_CODE[categoryCode] ?? 'Other';
}

export function sumAnnStoppageDelayBuckets(
  rows: Array<{ category_code?: string | null; duration_min?: number | string | null }>,
): Array<{ bucket: string; minutes: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const bucket = annStoppageDelayBucket(r.category_code);
    const min = Number(r.duration_min ?? 0);
    map.set(bucket, (map.get(bucket) ?? 0) + (Number.isFinite(min) ? min : 0));
  }
  return [...map.entries()]
    .map(([bucket, minutes]) => ({ bucket, minutes: Math.round(minutes * 10) / 10 }))
    .sort((a, b) => b.minutes - a.minutes);
}
