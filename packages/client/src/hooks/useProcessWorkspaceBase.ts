import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { isUserScopePath, userScopePath } from '../lib/userScope';
import { isProcessStationCode, type ProcessStationCode } from '../lib/processConfig';

/**
 * Base path and process code for non-CRM operator workspace routes.
 * Always returns an absolute path (`/user.operator`) so navigate() never
 * resolves relative to the current scope and doubles the URL (APK catch-all bounce).
 */
export function useProcessWorkspaceBase(): { basePath: string; processCode: ProcessStationCode } {
  const location = useLocation();
  const username = useAuthStore((s) => s.username);
  const role = useAuthStore((s) => s.role);
  const activeMachine = useAuthStore((s) => s.activeMachine);

  const workspace =
    username && role && isUserScopePath(location.pathname)
      ? { username, role }
      : null;

  const basePath = workspace ? userScopePath(workspace.username, workspace.role) : '';

  const machine = activeMachine && isProcessStationCode(activeMachine)
    ? activeMachine
    : 'HRS';

  return { basePath, processCode: machine };
}
