import { pickPrimaryRole, type UserRole } from '@m1/shared-validation';
import type { Role } from './authStore';

/** Prefer live SuperTokens JWT role over stale sessionStorage `mock_role`. */
export function roleFromAccessTokenPayload(
  payload: Record<string, unknown> | null | undefined,
): Role | null {
  if (!payload) return null;
  const roles = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  return (pickPrimaryRole(roles) as Role | null) ?? null;
}

export function isPlantWideDeskRole(role: Role | UserRole | null | undefined): boolean {
  return role === 'PLANT_HEAD' || role === 'ADMIN' || role === 'SUPERVISOR';
}