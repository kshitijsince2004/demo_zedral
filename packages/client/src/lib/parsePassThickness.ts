/** Allow partial decimal entry while typing (e.g. "2.", "0.45"). */
export function isPassThicknessDraft(raw: string): boolean {
  return raw === '' || /^\d*(\.\d*)?$/.test(raw);
}

/** Format stored thickness for display (trim trailing zeros). */
export function formatPassThickness(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const rounded = Math.round(value * 10_000) / 10_000;
  return String(rounded);
}

/** Parse numeric pass thickness preserving up to 4 decimal places. */
export function parsePassThickness(raw: string): number {
  if (!raw.trim() || raw === '.') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 10_000) / 10_000;
}
