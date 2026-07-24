import { useEffect } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { getEffectiveMachineAccess } from '../lib/machineRouting';
import { isCrmMillCode } from '../lib/millConfig';
import { getRoleHomePath } from '../lib/roleHome';
import { isUserScopePath, matchesUserScope } from '../lib/userScope';
import { MillAccessGate } from './MillAccessGate';
import { SixHiLayout } from './sixHi/SixHiLayout';

/**
 * Guards /:userScope routes (e.g. /operator.operator).
 * CRM mills render inside SixHiLayout; other machines use child routes.
 */
export function UserScopeShell() {
  const { userScope } = useParams<{ userScope: string }>();
  const username = useAuthStore((s) => s.username);
  const role = useAuthStore((s) => s.role);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const setActiveMachine = useAuthStore((s) => s.setActiveMachine);

  const machines = getEffectiveMachineAccess(role, machineAccess).map((m) => m.toUpperCase());
  const active = activeMachine?.toUpperCase() ?? null;
  const machine = active && machines.includes(active)
    ? active
    : machines[0] ?? null;

  useEffect(() => {
    if (machine && machine !== activeMachine) {
      setActiveMachine(machine);
    }
  }, [machine, activeMachine, setActiveMachine]);

  if (!userScope || !isUserScopePath(`/${userScope}`) || !matchesUserScope(userScope, username, role)) {
    return (
      <Navigate
        to={getRoleHomePath(role, lineAccess, machineAccess, username)}
        replace
      />
    );
  }

  if (machine && isCrmMillCode(machine)) {
    return (
      <MillAccessGate machine={machine}>
        <SixHiLayout />
      </MillAccessGate>
    );
  }

  return <Outlet />;
}
