const PLANT_TIME_ZONE = 'Asia/Kolkata';

function formatDateParts(parts: Intl.DateTimeFormatPart[]): string {
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function currentPlantDate(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PLANT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatDateParts(formatter.formatToParts(new Date()));
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Normalize API shift dates (Date objects or ISO strings) to YYYY-MM-DD. */
export function formatShiftDate(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '—';
  if (value instanceof Date) {
    return formatLocalDate(value);
  }
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return formatLocalDate(parsed);
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
