import { useOutletContext } from 'react-router-dom';
import { useAuthStore } from '../../lib/authStore';
import { isProcessStationCode } from '../../lib/processConfig';
import { ProcessHub } from '../../components/process/ProcessHub';

export function ProcessHubPage() {
  const outlet = useOutletContext<{ processCode?: string } | null>();
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const fromOutlet = outlet?.processCode && isProcessStationCode(outlet.processCode)
    ? outlet.processCode
    : null;
  const code = fromOutlet
    ?? (activeMachine && isProcessStationCode(activeMachine) ? activeMachine : 'HRS');
  return <ProcessHub processCode={code} />;
}
