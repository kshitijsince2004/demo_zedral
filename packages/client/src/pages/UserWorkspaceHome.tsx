import { useEffect } from 'react';
import { useAuthStore } from '../lib/authStore';
import { filterCrmMachines, getEffectiveMachineAccess, preferCrmMachine } from '../lib/machineRouting';
import { isCrmMillCode } from '../lib/millConfig';
import { MachineComingSoon } from './MachineComingSoon';
import { SixHiHub } from './sixHi/SixHiHub';

/** Index route for /username.role — CRM (6HI) operator workspace only. */
export function UserWorkspaceHome() {
  const role = useAuthStore((s) => s.role);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const setActiveMachine = useAuthStore((s) => s.setActiveMachine);

  const crmMachines = filterCrmMachines(getEffectiveMachineAccess(role, machineAccess));
  const resolved =
    activeMachine && isCrmMillCode(activeMachine) && crmMachines.includes(activeMachine)
      ? activeMachine
      : preferCrmMachine(crmMachines);

  useEffect(() => {
    if (resolved && resolved !== activeMachine) {
      setActiveMachine(resolved);
    }
  }, [resolved, activeMachine, setActiveMachine]);

  if (resolved && isCrmMillCode(resolved)) {
    return <SixHiHub />;
  }

  return <MachineComingSoon machineCode="6HI" />;
}
