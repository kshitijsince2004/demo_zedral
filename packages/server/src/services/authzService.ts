import { db, withTenantContext } from '../db';
import { getTenantId } from '../context';

export enum AuthzDecision {
  ALLOW = 'ALLOW',
  DENY = 'DENY'
}

export const authorize = async (
  userId: number,
  roles: string[],
  resource: string,
  action: string,
  targetLineOrSiteId?: string
): Promise<AuthzDecision> => {
  const tenantId = getTenantId();
  if (!tenantId) return AuthzDecision.DENY;

  return await withTenantContext(async (trx) => {
    // 1. Matrix match (role, resource, action)
    let matrixMatch = false;

    // Check if any of the user's roles have the permission
    const permissions = await trx.selectFrom('security.permission' as any)
      .selectAll()
      .where('role', 'in', roles)
      .where('resource', '=', resource)
      .where('action', '=', action)
      // RLS handles tenant_id, but good to be explicit
      .where('tenant_id', '=', tenantId)
      .execute();
    
    if (permissions.length > 0) {
      matrixMatch = true;
    }

    // Special case: ADMIN has full matrix access (from M1 pattern)
    if (roles.includes('ADMIN')) {
      matrixMatch = true;
    }

    if (!matrixMatch) {
      return AuthzDecision.DENY;
    }

    // 2. Row-scope match (Line_Access)
    if (targetLineOrSiteId) {
      // Admins bypass line scoping
      if (roles.includes('ADMIN')) {
        return AuthzDecision.ALLOW;
      }

      // Check line_access
      // We need to map targetLineOrSiteId to process_id, or assume it is the code.
      // In M1, Line_Access maps user_id to process_id. We'll join with master.process.
      const accessRows = await trx.selectFrom('security.line_access' as any)
        .innerJoin('master.process', 'security.line_access.process_id', 'master.process.process_id')
        .selectAll()
        .where('security.line_access.user_id', '=', userId)
        .where('master.process.code', '=', targetLineOrSiteId)
        .where('security.line_access.tenant_id', '=', tenantId as any)
        .execute();

      if (accessRows.length === 0) {
        return AuthzDecision.DENY;
      }

      const requiredLevel =
        action === 'approve' || action === 'lock' ? 'APPROVE'
        : action === 'write' || action === 'create' || action === 'update' ? 'WRITE'
        : 'READ';

      const levelRank: Record<string, number> = { READ: 1, WRITE: 2, APPROVE: 3 };
      const hasLevel = accessRows.some(
        (row) =>
          (levelRank[String((row as { access_level?: string }).access_level)] ?? 0)
          >= (levelRank[requiredLevel] ?? 1),
      );
      if (!hasLevel) {
        return AuthzDecision.DENY;
      }
    }

    return AuthzDecision.ALLOW;
  });
};
