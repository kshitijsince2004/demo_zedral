/** MH desk helpers for Rewinding line (RWD and/or 2HI in rewinding mode). */

function opsUpper(machines: string[]) {
  return machines.map((m) => m.toUpperCase());
}

/** Assigned rewinding-capable machines (RWD and/or 2HI). */
export function rwdAssigned(operationalMachines: string[]): Array<'RWD' | '2HI'> {
  const ops = new Set(opsUpper(operationalMachines));
  const out: Array<'RWD' | '2HI'> = [];
  if (ops.has('RWD')) out.push('RWD');
  if (ops.has('2HI')) out.push('2HI');
  return out;
}

/** True when MH should show Rewinding-focused nav — RWD assigned + focus RWD/2HI (or sole RWD). */
export function isRwdMhDesk(operationalMachines: string[], focus: string | null): boolean {
  const ops = opsUpper(operationalMachines);
  if (!ops.includes('RWD')) return false;
  const f = focus?.toUpperCase() ?? null;
  if (f === 'RWD') return true;
  // Stay on rewinding desk when toggling to 2HI (shared RWD+2HI MH).
  if (f === '2HI') return ops.includes('2HI');
  return ops.length === 1 && ops[0] === 'RWD';
}

/** Auto-pick RWD when it's the only assigned machine. */
export function syncRwdDeskFocus(
  operationalMachines: string[],
  focus: string | null,
  setFocus: (c: string | null) => void,
) {
  const ops = opsUpper(operationalMachines);
  if (ops.length === 1 && ops[0] === 'RWD' && focus !== 'RWD') {
    setFocus('RWD');
  }
}

export function resolveRwdLiveLine(
  operationalMachines: string[],
  focus: string | null,
): 'RWD' | '2HI' {
  const assigned = rwdAssigned(operationalMachines);
  const f = focus?.toUpperCase() ?? null;
  if (f === 'RWD' && assigned.includes('RWD')) return 'RWD';
  if (f === '2HI' && assigned.includes('2HI')) return '2HI';
  if (assigned.includes('RWD')) return 'RWD';
  if (assigned.includes('2HI')) return '2HI';
  return 'RWD';
}
