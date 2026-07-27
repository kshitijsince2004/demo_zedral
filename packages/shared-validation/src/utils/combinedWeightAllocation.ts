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

/** Sum of per-order actual weights in a combined run (ignores null/blank orders). */
export function resolveCombinedActualMt(actuals: Array<number | undefined | null>): number | undefined {
  const values = actuals.filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) return undefined;
  return roundMt(values.reduce((sum, v) => sum + v, 0));
}

/**
 * Split a combined total across blank siblings only; never overwrites entered weights.
 * Throws when combined total is not greater than the sum of already-entered weights.
 */
export function allocateCombinedRemainderToBlanks(
  snaps: Array<{ batchNumber: string; actualWeightMt: number | null }>,
  targets: WeightAllocationTarget[],
  combinedActualMt?: number,
): Map<string, number> | null {
  const filled = snaps.filter((s) => s.actualWeightMt != null);
  const blanks = snaps.filter((s) => s.actualWeightMt == null);
  if (blanks.length === 0) return null;
  if (combinedActualMt == null) return null;

  const enteredSum = roundMt(filled.reduce((s, x) => s + (x.actualWeightMt ?? 0), 0));
  const remainder = roundMt(combinedActualMt - enteredSum);
  if (remainder <= 0) {
    throw new Error(
      `Combined total ${combinedActualMt} MT is not greater than already-entered ${enteredSum} MT — check weights.`,
    );
  }

  const targetOf = (batchNumber: string) =>
    targets.find((t) => t.batchNumber === batchNumber)?.targetMt ?? 0;

  return allocateCombinedWeight(
    blanks.map((b) => ({ batchNumber: b.batchNumber, targetMt: targetOf(b.batchNumber) })),
    remainder,
  );
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
