import { useEffect } from 'react';
import { MachineHeadDashboard } from '../../live/MachineHeadDashboard';
import { useOperationalMachineAccess } from '../../../lib/useOperationalMachineAccess';
import { isAnnMhDesk, syncAnnDeskFocus, useMhDeskFocus } from '../../../lib/annMhDesk';
import { AnnMhLiveDashboard } from './AnnMhLiveDashboard';

/** `/live` + `/machine-head-dashboard` — ANN desk gets ANN live, else rolling MH dashboard. */
export function MhLiveEntry() {
  const machines = useOperationalMachineAccess();
  const focus = useMhDeskFocus((s) => s.focus);
  const setFocus = useMhDeskFocus((s) => s.setFocus);

  useEffect(() => {
    syncAnnDeskFocus(machines, focus, setFocus);
  }, [machines, focus, setFocus]);

  if (isAnnMhDesk(machines, focus)) return <AnnMhLiveDashboard />;
  return <MachineHeadDashboard />;
}
