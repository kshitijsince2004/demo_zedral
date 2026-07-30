import { useEffect } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { getEffectiveMachineAccess } from '../lib/machineRouting';
import { isCrmMillCode } from '../lib/millConfig';
import { isProcessStationCode } from '../lib/processConfig';
import { getRoleHomePath } from '../lib/roleHome';
import { isUserScopePath, matchesUserScope } from '../lib/userScope';
import { useTenantStationFlag } from '../hooks/useTenantStationFlag';
import { MillAccessGate } from './MillAccessGate';
import { SixHiLayout } from './sixHi/SixHiLayout';
import { StationAccessGate } from './process/StationAccessGate';
import { ProcessLayout } from './process/ProcessLayout';

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

  const stationCode = machine && isProcessStationCode(machine) ? machine : null;
  const { enabled: stationEnabled, loading: flagsLoading } = useTenantStationFlag(stationCode);

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

  if (machine && isProcessStationCode(machine)) {
    if (flagsLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
          Loading station feature flags…
        </div>
      );
    }

    if (!stationEnabled) {
      return <Navigate to={`/capture/${encodeURIComponent(machine)}`} replace />;
    }

    return (
      <StationAccessGate machine={machine}>
        <ProcessLayout />
      </StationAccessGate>
    );
  }

  return <Outlet />;
}
