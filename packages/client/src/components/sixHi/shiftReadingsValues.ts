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

/** Map shift-summary API fields into form strings (keeps 0). */
export function readingsFromSummary(summary: {
  scrapKg?: number | null;
  coolantTempDegC?: number | null;
  coolantPressKgCm2?: number | null;
} | null | undefined): ShiftReadingsValues {
  if (!summary) return { ...emptyShiftReadings };
  return {
    scrapKg: summary.scrapKg != null ? String(summary.scrapKg) : '',
    coolantTempDegC: summary.coolantTempDegC != null ? String(summary.coolantTempDegC) : '',
    coolantPressKgCm2: summary.coolantPressKgCm2 != null ? String(summary.coolantPressKgCm2) : '',
  };
}
