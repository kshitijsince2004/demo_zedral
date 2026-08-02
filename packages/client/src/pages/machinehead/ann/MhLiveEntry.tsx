import { useEffect } from 'react';
import { MachineHeadDashboard } from '../../live/MachineHeadDashboard';
import { useOperationalMachineAccess } from '../../../lib/useOperationalMachineAccess';
import { isAnnMhDesk, syncAnnDeskFocus, useMhDeskFocus } from '../../../lib/annMhDesk';
import {
  isHrsMhDesk,
  isHrsPklMhDesk,
  isPklMhDesk,
  resolveHrsPklLiveLine,
  syncClearInvalidDeskFocus,
  syncHrsDeskFocus,
  syncPklDeskFocus,
} from '../../../lib/pklMhDesk';
import { AnnMhLiveDashboard } from './AnnMhLiveDashboard';
import { ProcessLineLiveDashboard } from '../pkl/PklMhLiveDashboard';

/** `/live` — ANN → ANN live; HRS/PKL desk → line live; else rolling MH. */
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
  }, [machines, focus, setFocus]);

  if (isAnnMhDesk(machines, focus)) return <AnnMhLiveDashboard />;

  const hrsPklDesk =
    isHrsPklMhDesk(machines, focus) || isPklMhDesk(machines, focus) || isHrsMhDesk(machines, focus);
  if (hrsPklDesk) {
    const line = resolveHrsPklLiveLine(machines, focus);
    return <ProcessLineLiveDashboard line={line} />;
  }

  return <MachineHeadDashboard />;
}
