/** Normalize API shift dates (Date objects or ISO strings) to YYYY-MM-DD. */
export function formatShiftDate(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '—';
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return raw;
}

/** Format HH:MM:SS time strings for display (drops seconds when zero). */
export function formatShiftWindowTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parts = value.split(':');
  if (parts.length < 2) return value;
  const [h, m] = parts;
  return `${h}:${m}`;
}
