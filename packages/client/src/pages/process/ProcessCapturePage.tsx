import { useOutletContext, useParams } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import { isProcessStationCode } from '../../lib/processConfig';
import { CaptureWorkspace } from '../../components/process/CaptureWorkspace';
import { ProcessLiveStatusPage } from './ProcessLiveStatusPage';

export function ProcessCapturePage() {
  const { coilNo } = useParams<{ coilNo?: string }>();
  const outlet = useOutletContext<{ processCode?: string } | null>();
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const fromOutlet = outlet?.processCode && isProcessStationCode(outlet.processCode)
    ? outlet.processCode
    : null;
  const code = fromOutlet
    ?? (activeMachine && isProcessStationCode(activeMachine) ? activeMachine : 'HRS');

  if (!coilNo) {
    return <ProcessLiveStatusPage processCode={code} />;
  }

  return <CaptureWorkspace processCode={code} coilNo={decodeURIComponent(coilNo)} />;
}
