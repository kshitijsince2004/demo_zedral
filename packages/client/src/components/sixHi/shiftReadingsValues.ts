export interface ShiftReadingsValues {
  scrapKg: string;
  coolantTempDegC: string;
  coolantPressKgCm2: string;
}

export const emptyShiftReadings: ShiftReadingsValues = {
  scrapKg: '',
  coolantTempDegC: '',
  coolantPressKgCm2: '',
};

export function parseOptionalNumber(raw: string): number | null | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}