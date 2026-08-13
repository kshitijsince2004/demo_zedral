import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { getEffectiveMachineAccess, preferPrimaryMachine } from '../lib/machineRouting';
import { isCrmMillCode } from '../lib/millConfig';
import { isProcessStationCode } from '../lib/processConfig';
import { processStationEntry } from '../lib/processStationEntry';
import { getRoleHomePath } from '../lib/roleHome';
import { normalizeDoubledUserScopePath } from '../lib/scopeNavPath';
import { isUserScopePath, matchesUserScope } from '../lib/userScope';
import { useTenantStationFlag } from '../hooks/useTenantStationFlag';
import { MillAccessGate } from './MillAccessGate';
import { lazyNamed, RouteSpinner } from './RouteSpinner';
import { StationAccessGate } from './process/StationAccessGate';

const SixHiLayout = lazyNamed(() => import('./sixHi/SixHiLayout'), 'SixHiLayout');
const ProcessLayout = lazyNamed(() => import('./process/ProcessLayout'), 'ProcessLayout');

/**
 * Guards /:userScope routes (e.g. /operator.operator).
 * CRM mills render inside SixHiLayout; other machines use child routes.
 */
export function UserScopeShell() {
  const { userScope } = useParams<{ userScope: string }>();
  const location = useLocation();
  const username = useAuthStore((s) => s.username);
  const role = useAuthStore((s) => s.role);
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const setActiveMachine = useAuthStore((s) => s.setActiveMachine);

  const machines = getEffectiveMachineAccess(role, machineAccess).map((m) => m.toUpperCase());
  const active = activeMachine?.toUpperCase() ?? null;
  const primary = preferPrimaryMachine(role, machineAccess, lineAccess);
  const machine = active && machines.includes(active)
    ? active
    : primary ?? machines[0] ?? null;

  const stationCode = machine === 'CRS' || machine === 'CTL' ? machine : null;
  const { enabled: stationEnabled, loading: flagsLoading } = useTenantStationFlag(stationCode);

  useEffect(() => {
    if (machine && machine !== activeMachine) {
      setActiveMachine(machine);
    }
  }, [machine, activeMachine, setActiveMachine]);

  const repaired = normalizeDoubledUserScopePath(location.pathname);
  if (repaired && repaired !== location.pathname) {
    return <Navigate to={`${repaired}${location.search}`} replace />;
  }

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
        <Suspense fallback={<RouteSpinner />}>
          <SixHiLayout />
        </Suspense>
      </MillAccessGate>
    );
  }

  if (machine && isProcessStationCode(machine)) {
    const entry = processStationEntry(machine, stationEnabled);
    if (entry === 'disabled') {
      if (flagsLoading) {
        return (
          <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
            Loading station feature flags…
          </div>
        );
      }
      return (
        <div className="min-h-screen flex items-center justify-center p-6 text-sm text-muted-foreground">
          {machine} is not enabled for this plant.
        </div>
      );
    }

    return (
      <StationAccessGate machine={machine}>
        <Suspense fallback={<RouteSpinner />}>
          <ProcessLayout stationCode={machine} />
        </Suspense>
      </StationAccessGate>
    );
  }

  return <Outlet />;
}

/** Unmatched child under /:userScope → Orders index (avoid app-level * → /station bounce). */
export function UserScopeCatchAll() {
  const { userScope } = useParams<{ userScope: string }>();
  return <Navigate to={userScope ? `/${userScope}` : '/station'} replace />;
}
