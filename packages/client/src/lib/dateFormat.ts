export {
  PLANT_TIME_ZONE,
  IST_OFFSET,
  currentPlantDate,
  formatPlantDate,
  formatPlantDateTime,
  addPlantDays,
} from '@m1/shared-validation';

import { formatPlantDate } from '@m1/shared-validation';

/** Normalize API shift dates (Date objects or ISO strings) to YYYY-MM-DD in IST. */
export function formatShiftDate(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '—';
  return formatPlantDate(value);
}

/** Format HH:MM:SS time strings for display (drops seconds when zero). */
export function formatShiftWindowTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parts = value.split(':');
  if (parts.length < 2) return value;
  const [h, m] = parts;
  return `${h}:${m}`;
}
