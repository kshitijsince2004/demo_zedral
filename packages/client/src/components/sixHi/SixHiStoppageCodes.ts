/** Plant stoppage codes for 6HI order-level machine stoppages. */
export interface SixHiStoppageCodeDef {
  displayCode: string;
  categoryCode: string;
  breakdownCode?: string;
  label: string;
  requiresReason?: boolean;
  requiresRollChange?: boolean;
}

export const SixHi_STOPPAGE_CODES: SixHiStoppageCodeDef[] = [
  { displayCode: '01', categoryCode: 'BREAKDOWN', breakdownCode: 'S_ELEC', label: 'Breakdown', requiresReason: true },
  { displayCode: '02', categoryCode: 'MATERIAL', label: 'Material Issue', requiresReason: true },
  { displayCode: '03', categoryCode: 'POWER', label: 'Power Failure', requiresReason: true },
  { displayCode: '04', categoryCode: 'WR_CHANGE', label: 'Work Roll Change', requiresReason: true, requiresRollChange: true },
  { displayCode: '05', categoryCode: 'SETUP', label: 'Setup', requiresReason: false },
  { displayCode: '06', categoryCode: 'QUALITY_HOLD', label: 'Quality Hold', requiresReason: true },
];

export function resolveStoppageDisplayCode(categoryCode: string, breakdownCode?: string): string {
  const match = SixHi_STOPPAGE_CODES.find(
    (c) => c.categoryCode === categoryCode && (c.breakdownCode ?? null) === (breakdownCode ?? null),
  );
  return match?.displayCode ?? categoryCode;
}

export function findStoppageCodeDef(displayCode: string): SixHiStoppageCodeDef | undefined {
  return SixHi_STOPPAGE_CODES.find((c) => c.displayCode === displayCode);
}
