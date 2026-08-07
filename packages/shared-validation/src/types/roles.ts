/** Canonical role source — import from here, do not redefine locally. */

export enum UserRole {
  OPERATOR = 'OPERATOR',
  SUPERVISOR = 'SUPERVISOR',
  PLANNER = 'PLANNER',
  MACHINE_HEAD = 'MACHINE_HEAD',
  QUALITY = 'QUALITY',
  PLANT_HEAD = 'PLANT_HEAD',
  ADMIN = 'ADMIN',
}

export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.OPERATOR]: 0,
  [UserRole.SUPERVISOR]: 0,
  [UserRole.PLANNER]: 0,
  [UserRole.MACHINE_HEAD]: 1,
  [UserRole.QUALITY]: 2,
  [UserRole.PLANT_HEAD]: 3,
  [UserRole.ADMIN]: 4,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.OPERATOR]: 'Operator',
  [UserRole.SUPERVISOR]: 'Supervisor',
  [UserRole.PLANNER]: 'Planning',
  [UserRole.MACHINE_HEAD]: 'Machine head',
  [UserRole.QUALITY]: 'Quality',
  [UserRole.PLANT_HEAD]: 'Plant head',
  [UserRole.ADMIN]: 'Admin',
};

/** Normalize DB/JWT role strings to canonical enum values. */
export function normalizeRoleName(role: string): string {
  return String(role ?? '').trim().toUpperCase();
}

export function normalizeRoles(roles: string[] | undefined | null): string[] {
  if (!roles?.length) return [];
  const out: string[] = [];
  for (const r of roles) {
    const n = normalizeRoleName(r);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Highest-privilege role for client home / route guards. */
export function pickPrimaryRole(roles: string[] | undefined | null): UserRole | null {
  const normalized = normalizeRoles(roles);
  let best: UserRole | null = null;
  let bestRank = -1;
  for (const r of normalized) {
    const rank = ROLE_RANK[r as UserRole];
    if (rank != null && rank > bestRank) {
      best = r as UserRole;
      bestRank = rank;
    }
  }
  return best;
}
