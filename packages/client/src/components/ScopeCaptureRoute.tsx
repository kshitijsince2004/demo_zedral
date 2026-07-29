import { useAuthStore } from '../lib/authStore';
import { isCrmMillCode } from '../lib/millConfig';
import { SixHiCapturePage } from '../pages/sixHi/SixHiCapturePage';
import { ProcessCapturePage } from '../pages/process/ProcessCapturePage';

/** Routes capture to CRM or process workspace based on active machine. */
export function ScopeCaptureRoute() {
  const activeMachine = useAuthStore((s) => s.activeMachine);
  if (activeMachine && isCrmMillCode(activeMachine)) {
    return <SixHiCapturePage />;
  }
  return <ProcessCapturePage />;
}
