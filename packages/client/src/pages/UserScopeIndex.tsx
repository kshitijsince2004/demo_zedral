import { useAuthStore } from '../lib/authStore';
import { isCrmMillCode } from '../lib/millConfig';
import { SixHiHub } from './sixHi/SixHiHub';
import { UserWorkspaceHome } from './UserWorkspaceHome';

/** /username.role index — CRM hub or redirect for other machines. */
export function UserScopeIndex() {
  const activeMachine = useAuthStore((s) => s.activeMachine);

  if (activeMachine && isCrmMillCode(activeMachine)) {
    return <SixHiHub />;
  }

  return <UserWorkspaceHome />;
}
