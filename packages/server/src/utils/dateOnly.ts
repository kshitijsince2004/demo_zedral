export {
  PLANT_TIME_ZONE,
  IST_OFFSET,
  currentPlantDate,
  formatPlantDate,
  formatPlantDateTime,
  formatPlantTime,
  formatDbDate,
  addPlantDays,
  parsePlantDateOnly,
  startOfPlantDay,
  endOfPlantDay,
  plantWallClock,
  plantMinutesOfDay,
  plantClockDate,
  plantClockInstant,
  postgresDateOnly,
  plantDaysBetween,
  resolveShiftFromClock,
  nextPlantShift,
  DEFAULT_PLANT_SHIFT_WINDOWS,
} from '@m1/shared-validation';

import {
  formatPlantDate,
  parsePlantDateOnly,
  postgresDateOnly,
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
  return parsePlantDateOnly(value);
}

export function endOfDateFilter(value: string | Date): Date {
  const raw = formatPlantDate(value);
  return new Date(`${raw}T23:59:59.999+05:30`);
}
