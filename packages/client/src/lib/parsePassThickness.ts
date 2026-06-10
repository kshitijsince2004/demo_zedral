/** Parse numeric pass thickness preserving up to 4 decimal places. */
export function parsePassThickness(raw: string): number {
  if (!raw.trim()) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 10_000) / 10_000;
}
