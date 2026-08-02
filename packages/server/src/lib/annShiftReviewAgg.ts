/** Fixed ANN shift-review delay classes (server + tests). */
export const ANN_DELAY_ORDER = ['OPN', 'ELECT', 'MECH', 'UTILITY', 'POWER FAILURE'] as const;
export type AnnDelayBucket = (typeof ANN_DELAY_ORDER)[number];

/** Fallback when master.ann_stoppage_category.delay_bucket is null. */
export const ANN_CATEGORY_DELAY_FALLBACK: Record<string, AnnDelayBucket> = {
  BASE_FAN: 'MECH',
  BASE_SEAL: 'MECH',
  BASE_CLAMP: 'MECH',
  CA_BLOWER: 'MECH',
  THERMOCOUPLE: 'ELECT',
  BASE_WATER: 'UTILITY',
  GAS_SUPPLY: 'UTILITY',
  POWER: 'POWER FAILURE',
  CRANE: 'OPN',
  OTHER: 'OPN',
};

export function normalizeAnnDelayBucket(
  delayBucket: string | null | undefined,
  categoryCode?: string | null,
): AnnDelayBucket {
  const raw = (delayBucket || ANN_CATEGORY_DELAY_FALLBACK[String(categoryCode ?? 'OTHER')] || 'OPN').toUpperCase();
  return (ANN_DELAY_ORDER as readonly string[]).includes(raw) ? (raw as AnnDelayBucket) : 'OPN';
}

export function aggregateAnnDelayBuckets(
  rows: Array<{ delay_bucket?: string | null; category_code?: string | null; duration_min?: number | string | null }>,
): { delaySummary: Array<{ bucket: AnnDelayBucket; minutes: number }>; totalDelayMin: number } {
  const map = new Map<AnnDelayBucket, number>(ANN_DELAY_ORDER.map((b) => [b, 0]));
  for (const r of rows) {
    const bucket = normalizeAnnDelayBucket(r.delay_bucket, r.category_code);
    const min = Number(r.duration_min ?? 0);
    map.set(bucket, (map.get(bucket) ?? 0) + (Number.isFinite(min) ? min : 0));
  }
  const delaySummary = ANN_DELAY_ORDER.map((bucket) => ({
    bucket,
    minutes: Math.round((map.get(bucket) ?? 0) * 10) / 10,
  }));
  const totalDelayMin = Math.round(delaySummary.reduce((a, d) => a + d.minutes, 0) * 10) / 10;
  return { delaySummary, totalDelayMin };
}

export function mapAnnCrewRoles(
  rows: Array<{ operatorName?: string; roleCode?: string }>,
): {
  operatorEngineer: string;
  helper: string;
  craneOperator: string;
  shiftIncharge: string;
  signature: string;
} {
  const pick = (preds: string[]) => {
    const names = rows
      .filter((r) => {
        const role = (r.roleCode ?? '').toUpperCase();
        return preds.some((p) => role.includes(p));
      })
      .map((r) => r.operatorName)
      .filter(Boolean) as string[];
    return names.length ? [...new Set(names)].join(', ') : '—';
  };
  return {
    operatorEngineer: pick(['OPERATOR', 'ENGINEER', 'OPN']),
    helper: pick(['HELPER']),
    craneOperator: pick(['CRANE']),
    shiftIncharge: pick(['INCHARGE', 'IN-CHARGE', 'SHIFT IN']),
    signature: '—',
  };
}
