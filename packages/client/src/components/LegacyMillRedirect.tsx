import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { MillCode } from '../lib/millPath';
import { useAuthStore } from '../lib/authStore';
import { canAccessMachine } from '../lib/machineRouting';
import { getRoleHomePath } from '../lib/roleHome';
import { userScopePath } from '../lib/userScope';

/** Redirect legacy /6hi /4hi /2hi URLs to /username.role preserving sub-path. */
export function LegacyMillRedirect({ machine }: { machine: MillCode }) {
  const location = useLocation();
  const username = useAuthStore((s) => s.username);
  const role = useAuthStore((s) => s.role);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const setActiveMachine = useAuthStore((s) => s.setActiveMachine);

  useEffect(() => {
    // Do not pin 4HI/2HI when JWT has no write/nav access — that queued Forbidden sessions.
    if (canAccessMachine(role, machineAccess, machine)) {
      setActiveMachine(machine);
    }
  }, [machine, role, machineAccess, setActiveMachine]);

  if (!username || !role) {
    return <Navigate to="/login" replace />;
  }

  const legacyPrefix = machine === '4HI' ? '/4hi' : machine === '2HI' ? '/2hi' : '/6hi';
  const suffix = location.pathname.slice(legacyPrefix.length);
  const home = userScopePath(username, role);
  const target = suffix ? `${home}${suffix}` : home;

  if (location.pathname === target) {
    return <Navigate to={getRoleHomePath(role, lineAccess, machineAccess, username)} replace />;
  }

  return <Navigate to={`${target}${location.search}`} replace />;
}
