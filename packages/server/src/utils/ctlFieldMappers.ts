export function parsePlanCount(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
  const m = String(raw).trim().match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function distributeBundleWeightsKg(acceptedWeightKg: number, pieceCounts: number[]): number[] {
  const totalPcs = pieceCounts.reduce((a, b) => a + b, 0);
  if (acceptedWeightKg <= 0 || totalPcs <= 0) return pieceCounts.map(() => 0);
  return pieceCounts.map((pcs) => pcs <= 0 ? 0 : Math.round(((acceptedWeightKg * pcs) / totalPcs) * 1000) / 1000);
}
