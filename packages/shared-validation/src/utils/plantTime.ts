/** Indian Standard Time — fixed UTC+05:30, no DST. */
export const PLANT_TIME_ZONE = 'Asia/Kolkata';
export const IST_OFFSET = '+05:30';

export interface PlantClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function readPlantClockParts(at: Date): PlantClockParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PLANT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

export function getPlantClockParts(at: Date = new Date()): PlantClockParts {
  return readPlantClockParts(at);
}

/** YYYY-MM-DD on the plant calendar. */
export function formatPlantDate(value: string | Date): string {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return formatPlantDate(parsed);
    return raw.slice(0, 10);
  }
  const { year, month, day } = readPlantClockParts(value);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function currentPlantDate(): string {
  return formatPlantDate(new Date());
}

export function plantMinutesOfDay(at: Date = new Date()): number {
  const { hour, minute } = readPlantClockParts(at);
  return hour * 60 + minute;
}

/**
 * Synthetic Date whose getters return IST wall-clock fields. Use only where legacy
 * code reads getHours/getFullYear on a "plant now" value.
 */
export function plantWallClock(at: Date = new Date()): Date {
  const p = readPlantClockParts(at);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

export function addPlantDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00${IST_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatPlantDate(d);
}

/** Parse YYYY-MM-DD at IST midnight. */
export function parsePlantDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return parsePlantDateOnly(formatPlantDate(value));
  }
  const raw = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(value);
  return new Date(`${raw}T00:00:00${IST_OFFSET}`);
}

export function plantClockInstant(prodDate: string, hhmm: string): number {
  const date = formatPlantDate(prodDate);
  const time = hhmm.trim().slice(0, 5);
  return Date.parse(`${date}T${time}:00${IST_OFFSET}`);
}

export function plantClockDate(prodDate: string | Date, hhmm: string): Date {
  return new Date(plantClockInstant(formatPlantDate(prodDate), hhmm));
}

export function startOfPlantDay(value: string | Date): Date {
  return parsePlantDateOnly(value);
}

export function endOfPlantDay(value: string | Date): Date {
  const raw = formatPlantDate(value);
  return new Date(`${raw}T23:59:59.999${IST_OFFSET}`);
}

export function formatPlantDateTime(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', {
    timeZone: PLANT_TIME_ZONE,
    ...options,
  });
}
