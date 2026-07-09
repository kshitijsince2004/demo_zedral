export {
  PLANT_TIME_ZONE,
  IST_OFFSET,
  formatPlantDate,
  currentPlantDate,
  parsePlantDateOnly,
  startOfPlantDay,
  endOfPlantDay,
  plantWallClock,
  plantClockDate,
  plantClockInstant,
  addPlantDays,
  formatPlantDateTime,
} from '@m1/shared-validation';

import {
  endOfPlantDay,
  formatPlantDate,
  parsePlantDateOnly,
  startOfPlantDay,
} from '@m1/shared-validation';

/** @deprecated Use formatPlantDate */
export function formatDateOnly(value: string | Date): string {
  return formatPlantDate(value);
}

/** @deprecated Use parsePlantDateOnly */
export function parseDateOnly(value: string | Date): Date {
  return parsePlantDateOnly(value);
}

export function startOfDateFilter(value: string | Date): Date {
  return startOfPlantDay(value);
}

export function endOfDateFilter(value: string | Date): Date {
  return endOfPlantDay(value);
}

/**
 * Calendar date for Postgres DATE columns.
 * Use this for writes/filters — not parseDateOnly(), which is IST midnight as timestamptz
 * and truncates to the previous day when the DB session is UTC (CI).
 */
export function postgresDateOnly(value: string | Date): string {
  if (typeof value === 'string') {
    const raw = value.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  }
  return formatPlantDate(value);
}
