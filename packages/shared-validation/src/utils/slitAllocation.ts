/** Shared HRS/CRS slit weight + thickness resolution (client + fan-out consumer). */

export interface SlitAllocationInput {
  actual_weight_mt?: number | string | null;
  output_wt_mt?: number | string | null;
  planned_weight_mt?: number | string | null;
  width_mm?: number | string | null;
  thk_latest_mm?: number | string | null;
  planned_thk_mm?: number | string | null;
  actual_thk_front_mm?: number | string | null;
  thk_id_mm?: number | string | null;
  thk_mm?: number | string | null;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMt(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Width-proportional share of mother weight. Never returns the full mother
 * weight for one slit. Zero-width / missing widths fall back to equal split.
 */
export function widthProportionalShare(
  slit: SlitAllocationInput,
  allSlits: SlitAllocationInput[],
  motherWeightMt: number | string | null | undefined,
): number | null {
  const mother = num(motherWeightMt);
  if (mother == null || mother <= 0) return null;

  const widths = allSlits
    .map((s) => num(s.width_mm))
    .filter((w): w is number => w != null && w > 0);
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  const slitWidth = num(slit.width_mm);

  if (totalWidth > 0 && slitWidth != null && slitWidth > 0) {
    return roundMt((slitWidth / totalWidth) * mother);
  }

  const n = Math.max(allSlits.length, 1);
  return roundMt(mother / n);
}

/**
 * Resolve child-coil weight: live actual → CRS output → PPC planned → width share.
 * Never falls back to the full mother weight (that minted N× mother stock).
 */
export function resolveSlitWeightMt(
  slit: SlitAllocationInput,
  motherWeightMt: number | string | null | undefined,
  allSlits: SlitAllocationInput[],
): number | null {
  const actual = num(slit.actual_weight_mt);
  if (actual != null) return actual;
  const output = num(slit.output_wt_mt);
  if (output != null) return output;
  const planned = num(slit.planned_weight_mt);
  if (planned != null) return planned;
  return widthProportionalShare(slit, allSlits, motherWeightMt);
}

/**
 * Resolve child-coil thickness: latest reading → planned → CRS front → HRS ID → slit thk → mother.
 */
export function resolveSlitThkMm(
  slit: SlitAllocationInput,
  motherThkMm: number | string | null | undefined,
): number | null {
  return (
    num(slit.thk_latest_mm) ??
    num(slit.planned_thk_mm) ??
    num(slit.actual_thk_front_mm) ??
    num(slit.thk_id_mm) ??
    num(slit.thk_mm) ??
    num(motherThkMm)
  );
}
