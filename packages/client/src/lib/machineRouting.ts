import type { Role } from './authStore';
import { MACHINE_OPTIONS } from './accessOptions';
import { isCrmMillCode } from './millConfig';
import { millPathForCode } from './millPath';
import { usesUserScopeHome, userScopePath } from './userScope';

/** CRM mills supported on the operator terminal (6HI primary). */
export const CRM_MILL_CODES = ['6HI', '4HI', '2HI'] as const;

const MACHINE_LABELS: Record<string, string> = {
  '6HI': '6HI Mill',
  '4HI': '4HI Mill',
  '2HI': '2HI Mill',
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
  return `/coming-soon/${machineCode}`;
}

/** Plant head / admin: all assignable machines without DB rows. */
export function getEffectiveMachineAccess(role: Role | null, machineAccess: string[]): string[] {
  if (role === 'PLANT_HEAD' || role === 'ADMIN') {
    return [...MACHINE_OPTIONS];
  }
  return machineAccess;
}

/** Operator landing: CRM mills only; non-CRM lines are not in scope. */
export function resolvePrimaryMachinePath(
  role: Role | null,
  machineAccess: string[],
  _lineAccess: string[] = [],
): string | null {
  const machines = filterCrmMachines(getEffectiveMachineAccess(role, machineAccess));
  const preferred = preferCrmMachine(machines);
  if (preferred) {
    return pathForMachine(preferred);
  }
  if (role === 'OPERATOR' || role === 'SUPERVISOR' || role === 'MACHINE_HEAD') {
    return '/coming-soon/6HI';
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

/** Operator nav lists CRM mills only (6HI workflow). */
export function getMachineNavItems(
  role: Role | null,
  machineAccess: string[],
  _lineAccess: string[] = [],
  username?: string | null,
): MachineNavItem[] {
  const workspace = username && role && usesUserScopeHome(role) ? { username, role } : null;
  const crmMachines = filterCrmMachines(getEffectiveMachineAccess(role, machineAccess));
  const ordered = CRM_MILL_CODES.filter((c) => crmMachines.includes(c));

  return ordered.map((code) => ({
    code,
    label: MACHINE_LABELS[code] ?? code,
    path: pathForMachine(code, workspace),
    icon: '⊞',
  }));
}
