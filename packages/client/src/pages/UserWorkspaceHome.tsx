import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { filterCrmMachines, getEffectiveMachineAccess, pathForMachine, preferCrmMachine } from '../lib/machineRouting';
import { isCrmMillCode } from '../lib/millConfig';
import { MachineComingSoon } from './MachineComingSoon';
import { SixHiHub } from './sixHi/SixHiHub';

/** Index route for /username.role — CRM hub or non-CRM capture redirect. */
export function UserWorkspaceHome() {
  const role = useAuthStore((s) => s.role);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const setActiveMachine = useAuthStore((s) => s.setActiveMachine);

  const machines = getEffectiveMachineAccess(role, machineAccess);
  const crmMachines = filterCrmMachines(machines);
  const resolved =
    activeMachine && isCrmMillCode(activeMachine) && crmMachines.includes(activeMachine)
      ? activeMachine
      : preferCrmMachine(crmMachines) ?? activeMachine ?? machines[0] ?? null;

  useEffect(() => {
    if (resolved && resolved !== activeMachine) {
      setActiveMachine(resolved);
    }
  }, [resolved, activeMachine, setActiveMachine]);

  if (resolved && isCrmMillCode(resolved)) {
    return <SixHiHub />;
  }

  if (resolved) {
    return <Navigate to={pathForMachine(resolved)} replace />;
  }

  return <MachineComingSoon machineCode="6HI" />;
}
