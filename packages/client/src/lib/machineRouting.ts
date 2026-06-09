import type { Role } from './authStore';

import { MACHINE_OPTIONS } from './accessOptions';

import { isCrmMillCode } from './millConfig';

import { millPathForCode } from './millPath';

import { CANONICAL_PROCESS_CODES } from './processSectionRegistry';

import { usesUserScopeHome, userScopePath } from './userScope';



/** Shift-log capture screens that exist today. */

const BUILT_SHIFT_LINES = new Set<string>(CANONICAL_PROCESS_CODES as readonly string[]);



export function pathForMachine(

  machineCode: string,

  workspace?: { username: string; role: Role } | null,

): string {

  if (workspace && usesUserScopeHome(workspace.role) && isCrmMillCode(machineCode)) {

    return userScopePath(workspace.username, workspace.role);

  }

  if (isCrmMillCode(machineCode)) {

    return millPathForCode(machineCode);

  }

  if (BUILT_SHIFT_LINES.has(machineCode)) {

    return `/shift-log/${machineCode}`;

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



/** First assigned machine wins — 6HI is not the default. */

export function resolvePrimaryMachinePath(

  role: Role | null,

  machineAccess: string[],

  lineAccess: string[] = [],

): string | null {

  const machines = getEffectiveMachineAccess(role, machineAccess);

  if (machines.length > 0) {

    return pathForMachine(machines[0]);

  }



  if (lineAccess.length > 0) {

    const canonical = CANONICAL_PROCESS_CODES as readonly string[];

    const first = lineAccess.find((c) => canonical.includes(c as (typeof canonical)[number])) ?? lineAccess[0];

    if (first === '6HI') return '/6hi';

    if (BUILT_SHIFT_LINES.has(first)) return `/shift-log/${first}`;

    return `/coming-soon/${first}`;

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



const MACHINE_LABELS: Record<string, string> = {

  '6HI': '6HI Mill',

  '4HI': '4HI Mill',

  '2HI': '2HI Mill',

  HRS: 'Hot Rolling',

  PKL: 'Pickling',

  ANN: 'Annealing',

  RWD: 'Rewind',

  CRS: 'CR Slitter',

  CTL: 'Cut-to-Length',

};



export function getMachineNavItems(

  role: Role | null,

  machineAccess: string[],

  lineAccess: string[] = [],

  username?: string | null,

): MachineNavItem[] {

  const machines = getEffectiveMachineAccess(role, machineAccess);

  const workspace = username && role && usesUserScopeHome(role) ? { username, role } : null;

  const items: MachineNavItem[] = [];

  const seen = new Set<string>();



  for (const code of machines) {

    if (seen.has(code)) continue;

    seen.add(code);

    items.push({

      code,

      label: MACHINE_LABELS[code] ?? code,

      path: pathForMachine(code, workspace),

      icon: isCrmMillCode(code) ? '⊞' : '◉',

    });

  }



  if (role === 'OPERATOR' || role === 'MACHINE_HEAD' || role === 'SUPERVISOR') {

    for (const line of lineAccess) {

      if (seen.has(line) || line === '6HI') continue;

      if (machines.some((m) => isCrmMillCode(m))) continue;

      seen.add(line);

      items.push({

        code: line,

        label: MACHINE_LABELS[line] ?? line,

        path: pathForMachine(line, workspace),

        icon: '◉',

      });

    }

  }



  return items;

}


