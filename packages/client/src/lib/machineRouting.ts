import type { Role } from './authStore';
import { MACHINE_OPTIONS } from './accessOptions';
import { isCrmMillCode } from './millConfig';
import { millPathForCode } from './millPath';
import { usesUserScopeHome, userScopePath } from './userScope';

/** CRM mills supported on the operator terminal (6HI primary). */
export const CRM_MILL_CODES = ['6HI', '4HI', '2HI'] as const;
const NON_CRM_MACHINE_CODES = ['HRS', 'PKL', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'] as const;

const MACHINE_LABELS: Record<string, string> = {
  '6HI': '6HI Mill',
  '4HI': '4HI Mill',
  '2HI': '2HI Mill',
  HRS: 'HR Slitting',
  PKL: 'Pickling',
  ANN: 'Annealing',
  SKP: 'Skin Pass',
  RWD: 'Rewinding',
  CRS: 'CR Slitting',
  CTL: 'Cut-to-Length',
};

/** Prefer 6HI when the user has multiple CRM mill assignments. */
export function preferCrmMachine(machines: string[]): string | null {
  for (const code of CRM_MILL_CODES) {
    if (machines.includes(code)) return code;
  }
  return null;
}

export function filterCrmMachines(machines: string[]): string[] {
  return machines.filter(isCrmMillCode);
}

export function pathForMachine(
  machineCode: string,
  workspace?: { username: string; role: Role } | null,
): string {
  if (isCrmMillCode(machineCode)) {
    if (workspace && usesUserScopeHome(workspace.role)) {
      return userScopePath(workspace.username, workspace.role);
    }
    return millPathForCode(machineCode);
  }
  return `/capture/${machineCode}`;
}

/** Plant head / admin: prefer live JWT/DB machine list; fall back to static options. */
export function getEffectiveMachineAccess(role: Role | null, machineAccess: string[]): string[] {
  if (role === 'PLANT_HEAD' || role === 'ADMIN') {
    return machineAccess.length > 0 ? machineAccess : [...MACHINE_OPTIONS];
  }
  return machineAccess;
}

/** Operator landing: CRM mills first, then process capture for other assigned lines. */
export function resolvePrimaryMachinePath(
  role: Role | null,
  machineAccess: string[],
  _lineAccess: string[] = [],
): string | null {
  void _lineAccess;
  const machines = getEffectiveMachineAccess(role, machineAccess);
  const preferred = preferCrmMachine(filterCrmMachines(machines));
  if (preferred) {
    return pathForMachine(preferred);
  }
  const firstMachine = machines[0];
  if (firstMachine) {
    return pathForMachine(firstMachine);
  }
  if (role === 'OPERATOR' || role === 'MACHINE_HEAD') {
    return null;
  }
  return null;
}

export function canAccessMachine(
  role: Role | null,
  machineAccess: string[],
  machineCode: string,
): boolean {
  return getEffectiveMachineAccess(role, machineAccess).includes(machineCode);
}

export interface MachineNavItem {
  code: string;
  label: string;
  path: string;
  icon: string;
}

/** Operator nav lists all assigned machines: CRM mills first, then other capture lines. */
export function getMachineNavItems(
  role: Role | null,
  machineAccess: string[],
  _lineAccess: string[] = [],
  username?: string | null,
): MachineNavItem[] {
  void _lineAccess;
  const workspace = username && role && usesUserScopeHome(role) ? { username, role } : null;
  const machines = getEffectiveMachineAccess(role, machineAccess);
  const ordered = [
    ...CRM_MILL_CODES.filter((code) => machines.includes(code)),
    ...NON_CRM_MACHINE_CODES.filter((code) => machines.includes(code)),
    ...machines.filter(
      (code) => !CRM_MILL_CODES.includes(code as (typeof CRM_MILL_CODES)[number])
        && !NON_CRM_MACHINE_CODES.includes(code as (typeof NON_CRM_MACHINE_CODES)[number]),
    ),
  ];

  return ordered.map((code) => ({
    code,
    label: MACHINE_LABELS[code] ?? code,
    path: pathForMachine(code, workspace),
    icon: '⊞',
  }));
}
