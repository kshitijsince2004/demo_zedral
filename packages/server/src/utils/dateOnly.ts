const PLANT_TIME_ZONE = 'Asia/Kolkata';

function formatPartsToDate(parts: Intl.DateTimeFormatPart[]): string {
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function formatDateOnly(value: string | Date): string {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateOnly(parsed);
    }
    return raw.slice(0, 10);
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const raw = String(value).trim().slice(0, 10);
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return new Date(value);
  return new Date(year, month - 1, day);
}

export function currentPlantDate(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PLANT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatPartsToDate(formatter.formatToParts(new Date()));
}

export function startOfDateFilter(value: string | Date): Date {
  return parseDateOnly(value);
}

export function endOfDateFilter(value: string | Date): Date {
  const date = parseDateOnly(value);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}
