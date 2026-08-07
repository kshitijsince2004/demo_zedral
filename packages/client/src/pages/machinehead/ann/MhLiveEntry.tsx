import { lazy, Suspense, useEffect } from 'react';
import { MachineHeadDashboard } from '../../live/MachineHeadDashboard';
import { RouteSpinner } from '../../../components/RouteSpinner';
import { useOperationalMachineAccess } from '../../../lib/useOperationalMachineAccess';
import { useMhDeskFocus, resolveMhDesk, syncAnnDeskFocus } from '../../../lib/mhDesk';
import {
  resolveHrsPklLiveLine,
  syncClearInvalidDeskFocus,
  syncHrsDeskFocus,
  syncPklDeskFocus,
} from '../../../lib/pklMhDesk';
import { syncRwdDeskFocus } from '../../../lib/rwdMhDesk';
import { AnnMhLiveDashboard } from './AnnMhLiveDashboard';
import { RwdMhLiveDashboard } from '../RwdMhLiveDashboard';

// PERF-A3 — PKL/HRS live (recharts) only when that desk is active
const ProcessLineLiveDashboard = lazy(() =>
  import('../pkl/PklMhLiveDashboard').then((m) => ({ default: m.ProcessLineLiveDashboard })),
);

/** `/live` — ANN → ANN live; RWD → RWD live; HRS/PKL desk → line live; else rolling MH. */
export function MhLiveEntry() {
  const machines = useOperationalMachineAccess();
  const focus = useMhDeskFocus((s) => s.focus);
  const setFocus = useMhDeskFocus((s) => s.setFocus);

  useEffect(() => {
    syncClearInvalidDeskFocus(machines, focus, setFocus);
    const f = useMhDeskFocus.getState().focus;
    syncAnnDeskFocus(machines, f, setFocus);
    syncHrsDeskFocus(machines, useMhDeskFocus.getState().focus, setFocus);
    syncPklDeskFocus(machines, useMhDeskFocus.getState().focus, setFocus);
    syncRwdDeskFocus(machines, useMhDeskFocus.getState().focus, setFocus);
  }, [machines, focus, setFocus]);

  const desk = resolveMhDesk(machines, focus);
  if (desk === 'ann') return <AnnMhLiveDashboard />;
  if (desk === 'rwd') return <RwdMhLiveDashboard />;
  if (desk === 'hrs' || desk === 'pkl' || desk === 'hrs_pkl') {
    const line = resolveHrsPklLiveLine(machines, focus);
    return (
      <Suspense fallback={<RouteSpinner />}>
        <ProcessLineLiveDashboard line={line} />
      </Suspense>
    );
  }

  return <MachineHeadDashboard />;
}
