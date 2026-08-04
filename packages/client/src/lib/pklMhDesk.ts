import { syncAnnDeskFocus, useMhDeskFocus } from './annMhDesk';
import { syncRwdDeskFocus } from './rwdMhDesk';

export { useMhDeskFocus };

function opsUpper(machines: string[]) {
  return machines.map((m) => m.toUpperCase());
}

/** Intersection of assigned machines with HRS/PKL. */
export function hrsPklAssigned(operationalMachines: string[]): Array<'HRS' | 'PKL'> {
  const ops = new Set(opsUpper(operationalMachines));
  const out: Array<'HRS' | 'PKL'> = [];
  if (ops.has('HRS')) out.push('HRS');
  if (ops.has('PKL')) out.push('PKL');
  return out;
}

/** Lines that have a dedicated MH import page (independent of desk focus). */
export type ImportableLine = 'HRS' | 'PKL' | 'ANN' | 'RWD';

export function resolveImportableAssignedLines(operationalMachines: string[]): ImportableLine[] {
  const ops = new Set(opsUpper(operationalMachines));
  const out: ImportableLine[] = [];
  if (ops.has('HRS')) out.push('HRS');
  if (ops.has('PKL')) out.push('PKL');
  if (ops.has('ANN')) out.push('ANN');
  if (ops.has('RWD')) out.push('RWD');
  return out;
}

export function importPathForLine(line: ImportableLine): string {
  return `/machine-head/${line.toLowerCase()}/import`;
}

export function isHrsMhDesk(operationalMachines: string[], focus: string | null): boolean {
  const ops = opsUpper(operationalMachines);
  if (!ops.includes('HRS')) return false;
  if (focus?.toUpperCase() === 'HRS') return true;
  return ops.length === 1 && ops[0] === 'HRS';
}

/** True when MH should show the PKL-focused nav — only if PKL is assigned. */
export function isPklMhDesk(operationalMachines: string[], focus: string | null): boolean {
  const ops = opsUpper(operationalMachines);
  if (!ops.includes('PKL')) return false;
  if (focus?.toUpperCase() === 'PKL') return true;
  return ops.length === 1 && ops[0] === 'PKL';
}

/** Combined HRS+PKL desk (toggle) — both assigned; active when focus is HRS|PKL or ops are exactly the pair. */
export function isHrsPklMhDesk(operationalMachines: string[], focus: string | null): boolean {
  const ops = opsUpper(operationalMachines);
  const pair = hrsPklAssigned(ops);
  if (pair.length < 2) return false;
  const f = focus?.toUpperCase() ?? null;
  if (f === 'ANN') return false;
  if (f === 'HRS' || f === 'PKL') return true;
  return ops.length === 2 && ops.every((m) => m === 'HRS' || m === 'PKL');
}

/** Resolve HRS vs PKL live line — never pick an unassigned line from stale focus. */
export function resolveHrsPklLiveLine(
  operationalMachines: string[],
  focus: string | null,
): 'HRS' | 'PKL' {
  const ops = opsUpper(operationalMachines);
  const f = focus?.toUpperCase() ?? null;
  if (f === 'HRS' && ops.includes('HRS')) return 'HRS';
  if (f === 'PKL' && ops.includes('PKL')) return 'PKL';
  if (ops.includes('HRS') && !ops.includes('PKL')) return 'HRS';
  if (ops.includes('PKL') && !ops.includes('HRS')) return 'PKL';
  if (ops.includes('HRS')) return 'HRS';
  return 'PKL';
}

/** Auto-pick PKL when it's the only assigned machine. */
export function syncPklDeskFocus(
  operationalMachines: string[],
  focus: string | null,
  setFocus: (c: string | null) => void,
) {
  const ops = opsUpper(operationalMachines);
  if (ops.length === 1 && ops[0] === 'PKL' && focus !== 'PKL') {
    setFocus('PKL');
  }
}

export function syncHrsDeskFocus(
  operationalMachines: string[],
  focus: string | null,
  setFocus: (c: string | null) => void,
) {
  const ops = opsUpper(operationalMachines);
  if (ops.length === 1 && ops[0] === 'HRS' && focus !== 'HRS') {
    setFocus('HRS');
  }
}

/** Drop focus when it is not an assigned machine (stale session after switching MH users). */
export function syncClearInvalidDeskFocus(
  operationalMachines: string[],
  focus: string | null,
  setFocus: (c: string | null) => void,
) {
  if (!focus) return;
  const ops = opsUpper(operationalMachines);
  const f = focus.toUpperCase();
  if (ops.includes(f)) return;
  if (ops.length === 1) {
    setFocus(ops[0]);
    return;
  }
  setFocus(null);
}

/** Keep ANN + HRS + PKL sole-machine focus in sync; both HRS+PKL → default HRS if unset. */
export function syncMhDeskFocus(
  operationalMachines: string[],
  focus: string | null,
  setFocus: (c: string | null) => void,
) {
  syncClearInvalidDeskFocus(operationalMachines, focus, setFocus);
  const nextFocus = useMhDeskFocus.getState().focus;
  syncAnnDeskFocus(operationalMachines, nextFocus, setFocus);
  syncHrsDeskFocus(operationalMachines, useMhDeskFocus.getState().focus, setFocus);
  syncPklDeskFocus(operationalMachines, useMhDeskFocus.getState().focus, setFocus);
  syncRwdDeskFocus(operationalMachines, useMhDeskFocus.getState().focus, setFocus);

  const pair = hrsPklAssigned(operationalMachines);
  const ops = opsUpper(operationalMachines);
  // Only auto-focus HRS when the desk *is* the HRS+PKL pair (don't steal rolling/ANN focus).
  if (pair.length === 2 && ops.length === 2 && ops.every((m) => m === 'HRS' || m === 'PKL')) {
    const f = useMhDeskFocus.getState().focus?.toUpperCase() ?? null;
    if (f !== 'HRS' && f !== 'PKL') {
      setFocus('HRS');
    }
  }
}
