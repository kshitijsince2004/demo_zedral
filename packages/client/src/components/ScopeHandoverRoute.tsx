import { useAuthStore } from '../lib/authStore';
import { isCrmMillCode } from '../lib/millConfig';
import { CrmOutgoingHandoverPage } from '../pages/sixHi/CrmOutgoingHandoverPage';
import { ProcessHandoverPage } from '../pages/process/ProcessHandoverPage';

export function ScopeHandoverRoute() {
  const activeMachine = useAuthStore((s) => s.activeMachine);
  if (activeMachine && isCrmMillCode(activeMachine)) {
    return <CrmOutgoingHandoverPage />;
  }
  return <ProcessHandoverPage />;
}
