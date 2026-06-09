import type { MillCode } from './millPath';
import { isMillPath, millCodeFromPath } from './millPath';

export type MillProcessTab = 'rolling' | 'skinpass';

/** CRM 6HI / 4HI / 2HI share one operator UX; subprocess availability differs per mill. */
export function isCrmMillCode(code: string): code is MillCode {
  return code === '6HI' || code === '4HI' || code === '2HI';
}

export function isCrmMillPath(pathname: string): boolean {
  return isMillPath(pathname);
}

export function crmMillFromPath(pathname: string): MillCode {
  return millCodeFromPath(pathname);
}

/** Shift logs and line auth use master.process code 6HI for all CRM mills. */
export const CRM_SHIFT_PROCESS_CODE = '6HI';

export function millProcessTabs(machine: MillCode): MillProcessTab[] {
  if (machine === '2HI') return ['skinpass'];
  return ['rolling', 'skinpass'];
}

export function millSupportsRolling(machine: MillCode): boolean {
  return machine !== '2HI';
}

export function defaultMillTab(machine: MillCode): MillProcessTab {
  return millSupportsRolling(machine) ? 'rolling' : 'skinpass';
}

export function normalizeMillTab(machine: MillCode, tab: string | null): MillProcessTab {
  const resolved = tab === 'skinpass' ? 'skinpass' : 'rolling';
  if (!millSupportsRolling(machine) && resolved === 'rolling') return 'skinpass';
  return resolved;
}

export const MILL_HUB_TABS: { id: MillProcessTab; label: string }[] = [
  { id: 'rolling', label: 'Rolling' },
  { id: 'skinpass', label: 'Skin Pass' },
];

export function hubTabsForMill(machine: MillCode) {
  const allowed = new Set(millProcessTabs(machine));
  return MILL_HUB_TABS.filter((t) => allowed.has(t.id));
}
