/** Default OCR confidence threshold when machine has no ocr_min_confidence. */
export const DEFAULT_OCR_MIN_CONFIDENCE = 60;

/**
 * Parse the first numeric weight from OCR text.
 * Strips non-digit/non-dot chars, then takes the first `\d+(?:\.\d+)?` match.
 */
export function parseWeightFromOcrText(text: string): number | undefined {
  const m = text.replace(/[^0-9.]/g, ' ').match(/\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const value = Number(m[0]);
  return Number.isFinite(value) ? value : undefined;
}

/** Resolve per-machine threshold with default fallback. */
export function resolveOcrMinConfidence(value?: number | null): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_OCR_MIN_CONFIDENCE;
  return Math.min(100, Math.max(0, Number(value)));
}
