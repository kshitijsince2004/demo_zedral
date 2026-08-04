/**
 * Unified MH desk resolver — ANN wins, then RWD, then HRS/PKL.
 * Re-exports line helpers; prefer resolveMhDesk for /live routing.
 */
import { isAnnMhDesk, syncAnnDeskFocus, useMhDeskFocus } from './annMhDesk';
import {
  hrsPklAssigned,
  importPathForLine,
  isHrsMhDesk,
  isHrsPklMhDesk,
  isPklMhDesk,
  resolveHrsPklLiveLine,
  resolveImportableAssignedLines,
  syncClearInvalidDeskFocus,
  syncHrsDeskFocus,
  syncMhDeskFocus,
  syncPklDeskFocus,
} from './pklMhDesk';
import { isRwdMhDesk, resolveRwdLiveLine, rwdAssigned, syncRwdDeskFocus } from './rwdMhDesk';

export {
  useMhDeskFocus,
  isAnnMhDesk,
  syncAnnDeskFocus,
  isHrsMhDesk,
  isHrsPklMhDesk,
  isPklMhDesk,
  resolveHrsPklLiveLine,
  syncClearInvalidDeskFocus,
  syncHrsDeskFocus,
  syncMhDeskFocus,
  syncPklDeskFocus,
  hrsPklAssigned,
  resolveImportableAssignedLines,
  importPathForLine,
  isRwdMhDesk,
  resolveRwdLiveLine,
  rwdAssigned,
  syncRwdDeskFocus,
};

export type { ImportableLine } from './pklMhDesk';
export type MhDeskKind = 'ann' | 'rwd' | 'hrs' | 'pkl' | 'hrs_pkl' | 'rolling';

/** Single place for ANN-wins-tie desk ownership. */
export function resolveMhDesk(machines: string[], focus: string | null): MhDeskKind {
  if (isAnnMhDesk(machines, focus)) return 'ann';
  if (isRwdMhDesk(machines, focus)) return 'rwd';
  if (isHrsPklMhDesk(machines, focus)) return 'hrs_pkl';
  if (isHrsMhDesk(machines, focus)) return 'hrs';
  if (isPklMhDesk(machines, focus)) return 'pkl';
  return 'rolling';
}
