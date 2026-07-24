export {
  PLANT_TIME_ZONE,
  IST_OFFSET,
  currentPlantDate,
  formatPlantDate,
  formatPlantDateTime,
  formatPlantTime,
  formatPlantChartDay,
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
