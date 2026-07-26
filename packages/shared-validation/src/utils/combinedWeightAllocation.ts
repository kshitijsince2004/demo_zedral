/** Shared combined-run weight helpers (client form + server end cascade). */

export interface WeightAllocationTarget {
  batchNumber: string;
  targetMt: number;
}

function roundMt(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Sum of per-order PPC targets in a combined run. */
export function combinedTargetMt(targets: Array<{ targetMt: number }>): number {
  return roundMt(targets.reduce((sum, t) => sum + t.targetMt, 0));
}

/**
 * Resolve the combined actual weight shown in the form / used at end.
 * Legacy saves duplicated the same weight on every order — treat equal values as one combined total.
 * If only some orders have weight, sum the non-null values (partial allocation already applied).
 */
export function resolveCombinedActualMt(actuals: Array<number | undefined | null>): number | undefined {
  const values = actuals.filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) return undefined;
  const first = values[0];
  if (values.every((v) => v === first)) return first;
  return roundMt(values.reduce((sum, v) => sum + v, 0));
}

/**
 * Allocate combined actual weight across orders by filling smallest targets first,
 * then larger units — mirrors combined-run fill behaviour.
 */
export function allocateCombinedWeight(
  targets: WeightAllocationTarget[],
  combinedActualMt: number,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const target of targets) {
    result.set(target.batchNumber, 0);
  }

  if (!Number.isFinite(combinedActualMt) || combinedActualMt <= 0) {
    return result;
  }

  let remaining = combinedActualMt;
  const sorted = [...targets].sort(
    (a, b) => a.targetMt - b.targetMt || a.batchNumber.localeCompare(b.batchNumber),
  );

  for (const target of sorted) {
    if (remaining <= 0) break;
    const allocated = Math.min(target.targetMt, remaining);
    result.set(target.batchNumber, roundMt(allocated));
    remaining = roundMt(remaining - allocated);
  }

  const allocatedSum = [...result.values()].reduce((sum, v) => sum + v, 0);
  const remainder = roundMt(combinedActualMt - allocatedSum);
  if (remainder > 0 && sorted.length > 0) {
    const last = sorted[sorted.length - 1].batchNumber;
    result.set(last, roundMt((result.get(last) ?? 0) + remainder));
  }

  return result;
}
