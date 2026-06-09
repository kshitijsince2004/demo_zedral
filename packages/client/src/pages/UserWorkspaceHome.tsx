import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { pathForMachine } from '../lib/machineRouting';
import { isCrmMillCode } from '../lib/millConfig';
import { MachineComingSoon } from './MachineComingSoon';

/** Index route for /username.role when active machine is not a CRM mill. */
export function UserWorkspaceHome() {
  const role = useAuthStore((s) => s.role);
  const username = useAuthStore((s) => s.username);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const activeMachine = useAuthStore((s) => s.activeMachine);

  if (!activeMachine) {
    return <MachineComingSoon />;
  }

  if (isCrmMillCode(activeMachine)) {
    return null;
  }

  const workspace = username && role ? { username, role } : null;
  const target = pathForMachine(activeMachine, workspace);

  if (target.startsWith('/shift-log/') || target.startsWith('/coming-soon/')) {
    return <Navigate to={target} replace />;
  }

  return <MachineComingSoon />;
}
