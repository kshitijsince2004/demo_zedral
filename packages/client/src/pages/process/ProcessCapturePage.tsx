import { useParams } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import { isProcessStationCode } from '../../lib/processConfig';
import { CaptureWorkspace } from '../../components/process/CaptureWorkspace';

export function ProcessCapturePage() {
  const { coilNo } = useParams<{ coilNo?: string }>();
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const code = activeMachine && isProcessStationCode(activeMachine) ? activeMachine : 'HRS';

  if (!coilNo) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Select a coil from the hub queue to start capture.
      </div>
    );
  }

  return <CaptureWorkspace processCode={code} coilNo={decodeURIComponent(coilNo)} />;
}
