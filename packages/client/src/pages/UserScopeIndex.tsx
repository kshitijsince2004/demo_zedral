import { useAuthStore } from '../lib/authStore';
import { isCrmMillCode } from '../lib/millConfig';
import { isProcessStationCode } from '../lib/processConfig';
import { SixHiHub } from './sixHi/SixHiHub';
import { ProcessHubPage } from './process/ProcessHubPage';
import { UserWorkspaceHome } from './UserWorkspaceHome';

/** /username.role index — CRM hub, process hub, or redirect. */
export function UserScopeIndex() {
  const activeMachine = useAuthStore((s) => s.activeMachine);

  if (activeMachine && isCrmMillCode(activeMachine)) {
    return <SixHiHub />;
  }

  if (activeMachine && isProcessStationCode(activeMachine)) {
    return <ProcessHubPage />;
  }

  return <UserWorkspaceHome />;
}
