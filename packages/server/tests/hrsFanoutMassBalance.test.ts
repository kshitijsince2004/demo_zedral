import { describe, it, expect } from 'vitest';
import {
  calculateScrapPct,
  resolveSlitThkMm,
  resolveSlitWeightMt,
} from '@m1/shared-validation';

/** Pre-fix spawn fallback: actual ?? output ?? full mother weight. */
function legacySpawnWeight(
  slit: { actual_weight_mt?: number | null; output_wt_mt?: number | null },
  motherWeightMt: number,
): number {
  return slit.actual_weight_mt != null
    ? Number(slit.actual_weight_mt)
    : slit.output_wt_mt != null
      ? Number(slit.output_wt_mt)
      : motherWeightMt;
}

describe('HRS fan-out mass balance', () => {
  const mother = 20;
  const slits = [
    { slot: 'A', width_mm: 300, planned_weight_mt: 5, planned_thk_mm: 2.0 },
    { slot: 'B', width_mm: 300, planned_weight_mt: 5, planned_thk_mm: 2.0 },
    { slot: 'C', width_mm: 300, planned_weight_mt: 5, planned_thk_mm: 2.0 },
    { slot: 'D', width_mm: 300, planned_weight_mt: 5, planned_thk_mm: 2.0 },
  ];

  it('characterization: legacy fallback minted full mother weight on every slit', () => {
    const minted = slits.map((s) => legacySpawnWeight(s, mother));
    expect(minted.reduce((a, b) => a + b, 0)).toBe(80);
  });

  it('resolveSlitWeightMt uses planned weights (Σ ≈ mother, never N×mother)', () => {
    const minted = slits.map((s) => resolveSlitWeightMt(s, mother, slits) ?? 0);
    expect(minted).toEqual([5, 5, 5, 5]);
    expect(minted.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it('thickness precedence: latest → planned → mother', () => {
    expect(resolveSlitThkMm({ thk_latest_mm: 1.85, planned_thk_mm: 2 }, 2.2)).toBe(1.85);
    expect(resolveSlitThkMm({ planned_thk_mm: 2 }, 2.2)).toBe(2);
    expect(resolveSlitThkMm({}, 2.2)).toBe(2.2);
  });

  it('scrap % uses mother input weight on client and server (same helper)', () => {
    const scrapMt = 0.4;
    const motherInputWt = 20;
    const producedWt = 19.6;
    const shared = calculateScrapPct(scrapMt, motherInputWt);
    expect(shared).toBe(2);
    expect(shared).not.toBe(calculateScrapPct(scrapMt, producedWt));
  });
});
