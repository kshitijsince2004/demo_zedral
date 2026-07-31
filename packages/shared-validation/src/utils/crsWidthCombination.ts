/** Width-combination: Σ(finish_width × no_of_slit) + edge_trim ≤ input_width. */
export function crsWidthCombinationWarn(
  inputWidthMm: number,
  lines: Array<{ finishWidthMm?: number; noOfSlit?: number }>,
  edgeTrimMm = 0,
  finWidthTolMm = 0,
): { ok: boolean; packedMm: number; message?: string } {
  if (inputWidthMm <= 0) return { ok: true, packedMm: 0 };
  const packedMm = lines.reduce((s, l) => {
    const w = l.finishWidthMm ?? 0;
    const n = Math.max(1, l.noOfSlit ?? 1);
    return s + w * n;
  }, 0) + edgeTrimMm;
  if (packedMm > inputWidthMm + finWidthTolMm) {
    return {
      ok: false,
      packedMm,
      message: `Packed width ${packedMm.toFixed(1)} mm exceeds input ${inputWidthMm} mm`,
    };
  }
  return { ok: true, packedMm };
}
