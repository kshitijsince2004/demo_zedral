import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { millBasePath, millCodeFromPath, type MillCode } from '../lib/millPath';
import { isUserScopePath } from '../lib/userScope';

/** Active CRM / workspace base path and machine code for the current route. */
export function useWorkspaceBase(): { basePath: string; machineCode: MillCode } {
  const location = useLocation();
  const username = useAuthStore((s) => s.username);
  const role = useAuthStore((s) => s.role);
  const activeMachine = useAuthStore((s) => s.activeMachine);

  const workspace =
    username && role && isUserScopePath(location.pathname)
      ? { username, role }
      : null;

  const machineCode = millCodeFromPath(
    location.pathname,
    activeMachine as MillCode | null,
  );

  const basePath = millBasePath(machineCode, workspace);

  return { basePath, machineCode };
}
