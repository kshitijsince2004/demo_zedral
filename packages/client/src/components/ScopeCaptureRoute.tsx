import { useOutletContext } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { isCrmMillCode } from '../lib/millConfig';
import { isProcessStationCode } from '../lib/processConfig';
import { SixHiCapturePage } from '../pages/sixHi/SixHiCapturePage';
import { ProcessCapturePage } from '../pages/process/ProcessCapturePage';

/** Routes capture to CRM or process workspace based on active machine / layout context. */
export function ScopeCaptureRoute() {
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const outlet = useOutletContext<{ processCode?: string } | null>();
  const processHint = outlet?.processCode;
  const useProcess =
    (activeMachine != null && isProcessStationCode(activeMachine))
    || (processHint != null && isProcessStationCode(processHint));
  const useCrm = !useProcess && activeMachine != null && isCrmMillCode(activeMachine);

  if (useCrm) {
    return <SixHiCapturePage />;
  }
  return <ProcessCapturePage />;
}
