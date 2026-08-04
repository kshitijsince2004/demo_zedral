import { Navigate, useOutletContext, useParams } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import { isProcessStationCode } from '../../lib/processConfig';
import { CaptureWorkspace } from '../../components/process/CaptureWorkspace';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { ProcessLiveStatusPage } from './ProcessLiveStatusPage';

export function ProcessCapturePage() {
  const { coilNo } = useParams<{ coilNo?: string }>();
  const outlet = useOutletContext<{ processCode?: string } | null>();
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const { basePath } = useProcessWorkspaceBase();
  const fromOutlet = outlet?.processCode && isProcessStationCode(outlet.processCode)
    ? outlet.processCode
    : null;
  const code = fromOutlet
    ?? (activeMachine && isProcessStationCode(activeMachine) ? activeMachine : 'HRS');

  if (!coilNo) {
    return <ProcessLiveStatusPage processCode={code} />;
  }

  // RWD capture lives on /rewinding/:coil — not CaptureWorkspace.
  if (code === 'RWD') {
    const decoded = decodeURIComponent(coilNo);
    return <Navigate to={`${basePath}/rewinding/${encodeURIComponent(decoded)}`} replace />;
  }

  return <CaptureWorkspace processCode={code} coilNo={decodeURIComponent(coilNo)} />;
}
