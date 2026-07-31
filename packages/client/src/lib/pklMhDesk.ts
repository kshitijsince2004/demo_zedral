import { syncAnnDeskFocus, useMhDeskFocus } from './annMhDesk';

export { useMhDeskFocus };

/** True when MH should show the PKL-focused nav. */
export function isPklMhDesk(operationalMachines: string[], focus: string | null): boolean {
  if (focus?.toUpperCase() === 'PKL') return true;
  const ops = operationalMachines.map((m) => m.toUpperCase());
  return ops.length === 1 && ops[0] === 'PKL';
}

/** Auto-pick PKL when it's the only assigned machine. */
export function syncPklDeskFocus(
  operationalMachines: string[],
  focus: string | null,
  setFocus: (c: string | null) => void,
) {
  const ops = operationalMachines.map((m) => m.toUpperCase());
  if (ops.length === 1 && ops[0] === 'PKL' && focus !== 'PKL') {
    setFocus('PKL');
  }
}

/** Keep ANN + PKL sole-machine focus in sync (ANN wins if somehow both sole — impossible). */
export function syncMhDeskFocus(
  operationalMachines: string[],
  focus: string | null,
  setFocus: (c: string | null) => void,
) {
  syncAnnDeskFocus(operationalMachines, focus, setFocus);
  syncPklDeskFocus(operationalMachines, focus, setFocus);
}
