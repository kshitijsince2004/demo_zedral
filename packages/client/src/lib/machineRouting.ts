import type { Role } from './authStore';
import { MACHINE_OPTIONS } from './accessOptions';
import { isCrmMillCode } from './millConfig';
import { isProcessStationCode } from './processConfig';
import { millPathForCode } from './millPath';
import { usesUserScopeHome, userScopePath } from './userScope';

/** CRM mills supported on the operator terminal (6HI primary). */
export const CRM_MILL_CODES = ['6HI', '4HI', '2HI'] as const;
export const NON_CRM_MACHINE_CODES = ['HRS', 'PKL', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'] as const;

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
  if (isProcessStationCode(machineCode) && workspace && usesUserScopeHome(workspace.role)) {
    return userScopePath(workspace.username, workspace.role);
  }
  return `/capture/${machineCode}`;
}

/** Plant head / admin / supervisor: prefer live JWT/DB machine list; fall back to static options. */
export function getEffectiveMachineAccess(role: Role | null, machineAccess: string[]): string[] {
  const normalized = machineAccess.map((m) => m.toUpperCase());
  if (role === 'SUPERVISOR' || role === 'PLANT_HEAD' || role === 'ADMIN') {
    return normalized.length > 0 ? normalized : [...MACHINE_OPTIONS];
  }
  return normalized;
}

/**
 * Default active machine after login.
 * CRM mills first; else prefer a process machine that matches lineAccess;
 * else stable NON_CRM order (HRS before PKL — never raw JWT array order).
 */
export function preferPrimaryMachine(
  role: Role | null,
  machineAccess: string[],
  lineAccess: string[] = [],
): string | null {
  const machines = getEffectiveMachineAccess(role, machineAccess);
  const crm = preferCrmMachine(filterCrmMachines(machines));
  if (crm) return crm;

  const lines = new Set(lineAccess.map((l) => l.toUpperCase()));
  if (lines.size > 0) {
    for (const code of NON_CRM_MACHINE_CODES) {
      if (machines.includes(code) && lines.has(code)) return code;
    }
  }
  for (const code of NON_CRM_MACHINE_CODES) {
    if (machines.includes(code)) return code;
  }
  return machines[0] ?? null;
}

/** Operator landing: CRM mills first, then process capture for other assigned lines. */
export function resolvePrimaryMachinePath(
  role: Role | null,
  machineAccess: string[],
  lineAccess: string[] = [],
): string | null {
  const preferred = preferPrimaryMachine(role, machineAccess, lineAccess);
  if (preferred) {
    return pathForMachine(preferred);
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
  return getEffectiveMachineAccess(role, machineAccess).includes(machineCode.toUpperCase());
}

/**
 * WRITE allowlist matching server assertMachineAccess:
 * Admin/Plant Head → all machines (null).
 * Everyone else (incl. Supervisor) → JWT machine_access only (no UI plant-wide expand).
 */
export function getWriteMachineAccess(
  role: Role | null,
  machineAccess: string[],
): string[] | null {
  if (role === 'ADMIN' || role === 'PLANT_HEAD') return null;
  return machineAccess.map((m) => m.toUpperCase()).filter(Boolean);
}

/** True when POST/PUT/PATCH to this mill is allowed (same rules as server). */
export function canWriteMachine(
  role: Role | null,
  machineAccess: string[],
  machineCode: string,
): boolean {
  const allow = getWriteMachineAccess(role, machineAccess);
  if (allow === null) return true;
  return allow.includes(machineCode.toUpperCase());
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
