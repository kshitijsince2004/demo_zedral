/**
 * Machine Classification tokens for defect/stoppage masters (`applies_to`).
 * Admin multi-select stores a comma-separated list of these values.
 */

export const MACHINE_CLASSIFICATION_OPTIONS = [
  { value: 'HRS', label: 'HRS' },
  { value: 'PKL', label: 'PKL' },
  { value: 'CRM6', label: 'Rolling Line (6HI / 4HI / 2HI)' },
  { value: 'ANN', label: 'ANN' },
  { value: 'RWD', label: 'RWD' },
  { value: 'CRS', label: 'CRS' },
  { value: 'CTL', label: 'CTL' },
  { value: 'SKP', label: 'SKP' },
] as const;

export type MachineClassification = (typeof MACHINE_CLASSIFICATION_OPTIONS)[number]['value'];

const ROLLING_TOKENS = new Set(['CRM6', '6HI', '4HI', '2HI', 'CRM']);

/** Parse comma/space-separated applies_to into uppercase tokens. */
export function parseMachineClassification(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .toUpperCase()
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function serializeMachineClassification(tokens: string[]): string {
  return tokens
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .join(',');
}

/**
 * True when a master row applies to `machine`.
 * Empty / null classification = all machines (backward-compatible for untagged rows).
 */
export function matchesMachineClassification(
  raw: string | null | undefined,
  machine: string | null | undefined,
): boolean {
  if (!machine?.trim()) return true;
  const tokens = parseMachineClassification(raw);
  if (tokens.length === 0) return true;

  const m = machine.trim().toUpperCase();
  if (tokens.includes(m)) return true;

  // Rolling mills share the CRM6 catalogue
  if (ROLLING_TOKENS.has(m) && tokens.some((t) => ROLLING_TOKENS.has(t))) return true;

  return false;
}
