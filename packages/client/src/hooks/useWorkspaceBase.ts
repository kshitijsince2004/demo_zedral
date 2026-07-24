import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import {
  filterCrmMachines,
  getEffectiveMachineAccess,
  preferCrmMachine,
} from '../lib/machineRouting';
import { isCrmMillCode } from '../lib/millConfig';
import { millBasePath, millCodeFromPath, type MillCode } from '../lib/millPath';
import { isUserScopePath } from '../lib/userScope';

/** Active CRM / workspace base path and machine code for the current route. */
export function useWorkspaceBase(): { basePath: string; machineCode: MillCode } {
  const location = useLocation();
  const username = useAuthStore((s) => s.username);
  const role = useAuthStore((s) => s.role);
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const machineAccess = useAuthStore((s) => s.machineAccess);

  const workspace =
    username && role && isUserScopePath(location.pathname)
      ? { username, role }
      : null;

  let machineCode = millCodeFromPath(
    location.pathname,
    activeMachine as MillCode | null,
  );

  // User-scope URLs have no mill in the path — never keep a stale/default mill
  // the user is not assigned (e.g. 6HI default while MH only has 4HI).
  if (workspace) {
    const assigned = filterCrmMachines(getEffectiveMachineAccess(role, machineAccess));
    if (assigned.length > 0 && !assigned.includes(machineCode)) {
      const preferred = preferCrmMachine(assigned) ?? assigned[0];
      if (preferred && isCrmMillCode(preferred)) machineCode = preferred;
    }
  }

  const basePath = millBasePath(machineCode, workspace);

  return { basePath, machineCode };
}
