import type { Role } from './authStore';
import { UserRole } from '@m1/shared-validation';

/** URL segment slug for a role, e.g. OPERATOR → operator, MACHINE_HEAD → machine_head */
export function roleSlug(role: Role): string {
  return role.toLowerCase();
}

const SLUG_TO_ROLE: Record<string, Role> = {
  operator: UserRole.OPERATOR,
  machine_head: UserRole.MACHINE_HEAD,
  supervisor: UserRole.SUPERVISOR,
  plant_head: UserRole.PLANT_HEAD,
  admin: UserRole.ADMIN,
};

/** Canonical user workspace path: /operator.operator, /supervisor.supervisor, … */
export function userScopePath(username: string, role: Role): string {
  return `/${username.toLowerCase()}.${roleSlug(role)}`;
}

export function parseUserScope(segment: string): { username: string; roleSlug: string } | null {
  const dot = segment.lastIndexOf('.');
  if (dot <= 0 || dot === segment.length - 1) return null;
  return {
    username: segment.slice(0, dot).toLowerCase(),
    roleSlug: segment.slice(dot + 1).toLowerCase(),
  };
}

export function roleFromSlug(slug: string): Role | null {
  return SLUG_TO_ROLE[slug.toLowerCase()] ?? null;
}

export function isUserScopePath(pathname: string): boolean {
  const segment = pathname.split('/').filter(Boolean)[0];
  if (!segment) return false;
  const parsed = parseUserScope(segment);
  if (!parsed) return false;
  return roleFromSlug(parsed.roleSlug) !== null;
}

export function userScopeFromPath(pathname: string): string | null {
  const segment = pathname.split('/').filter(Boolean)[0];
  if (!segment || !isUserScopePath(`/${segment}`)) return null;
  return segment.toLowerCase();
}

export function matchesUserScope(
  scopeSegment: string | undefined,
  username: string | null,
  role: Role | null,
): boolean {
  if (!scopeSegment || !username || !role) return false;
  const parsed = parseUserScope(scopeSegment);
  if (!parsed) return false;
  return (
    parsed.username === username.toLowerCase() &&
    parsed.roleSlug === roleSlug(role)
  );
}

/** Roles that use /username.role as their primary workspace URL. */
export function usesUserScopeHome(role: Role | null): boolean {
  return role === UserRole.OPERATOR || role === UserRole.MACHINE_HEAD || role === UserRole.SUPERVISOR;
}
