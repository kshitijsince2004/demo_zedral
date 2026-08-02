import { create } from 'zustand';

const KEY = 'mh.deskFocus';

function loadFocus(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** MH desk line focus — drives ANN vs shared side nav. */
export const useMhDeskFocus = create<{
  focus: string | null;
  setFocus: (code: string | null) => void;
}>((set) => ({
  focus: loadFocus(),
  setFocus: (code) => {
    const next = code ? code.toUpperCase() : null;
    try {
      if (next) sessionStorage.setItem(KEY, next);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({ focus: next });
  },
}));

/** True when MH should show the 7-item ANN nav — only if ANN is assigned. */
export function isAnnMhDesk(operationalMachines: string[], focus: string | null): boolean {
  const ops = operationalMachines.map((m) => m.toUpperCase());
  if (!ops.includes('ANN')) return false;
  if (focus?.toUpperCase() === 'ANN') return true;
  return ops.length === 1 && ops[0] === 'ANN';
}

/** Auto-pick ANN when it's the only assigned machine. */
export function syncAnnDeskFocus(operationalMachines: string[], focus: string | null, setFocus: (c: string | null) => void) {
  const ops = operationalMachines.map((m) => m.toUpperCase());
  if (ops.length === 1 && ops[0] === 'ANN' && focus !== 'ANN') {
    setFocus('ANN');
  }
}
