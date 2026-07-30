import { useAuthStore } from '../../lib/authStore';
import { isProcessStationCode } from '../../lib/processConfig';
import { ProcessHub } from '../../components/process/ProcessHub';

export function ProcessHubPage() {
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const code = activeMachine && isProcessStationCode(activeMachine) ? activeMachine : 'HRS';
  return <ProcessHub processCode={code} />;
}
