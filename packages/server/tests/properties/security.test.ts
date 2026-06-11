import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { requireRole, requireLineAccess } from '../../src/middleware/authMiddleware';
import { assertLineOperation, ensureLineScopes } from '../../src/auth/lineAccessPolicy';

// Mock express req, res, next
const mockRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('Property Tests: Security and RBAC', () => {

  // Property 11: Role-based access control enforcement
  describe('Property 11: RBAC Enforcement', () => {
    it('requireRole: should allow if user has required role, else deny', () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom('OPERATOR', 'SUPERVISOR', 'PLANT_HEAD', 'ADMIN')), // user roles
          fc.constantFrom('OPERATOR', 'SUPERVISOR', 'PLANT_HEAD', 'ADMIN'), // required role
          (userRoles, requiredRole) => {
            const req: any = { user: { roles: userRoles } };
            const res = mockRes();
            const next = vi.fn();

            const middleware = requireRole(requiredRole as any);
            middleware(req, res, next);

            const isAllowed = userRoles.includes(requiredRole) || userRoles.includes('ADMIN');

            if (isAllowed) {
              expect(next).toHaveBeenCalled();
              expect(res.status).not.toHaveBeenCalled();
            } else {
              expect(res.status).toHaveBeenCalledWith(403);
              expect(next).not.toHaveBeenCalled();
            }
          }
        )
      );
    });

    it('requireLineAccess: should enforce line isolation and operation level', () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom('OPERATOR', 'SUPERVISOR', 'PLANT_HEAD', 'ADMIN')), // user roles
          fc.array(fc.string({ minLength: 1 })), // user line access
          fc.constantFrom('READ', 'WRITE', 'APPROVE'), // requested operation
          fc.string({ minLength: 1 }), // requested line
          (userRoles, lineAccess, operation, requestedLine) => {
            const user = ensureLineScopes({
              id: 1,
              username: 'test',
              roles: userRoles,
              lineAccess,
              lineScopes: [],
            } as any);

            const req: any = {
              user,
              body: { processLine: requestedLine },
              params: {},
              query: {},
            };
            const res = mockRes();
            const next = vi.fn();

            const middleware = requireLineAccess(operation as any);
            middleware(req, res, next);

            let shouldAllow = true;
            try {
              assertLineOperation(user, requestedLine, operation as any);
            } catch {
              shouldAllow = false;
            }

            if (shouldAllow) {
              expect(next).toHaveBeenCalled();
            } else {
              expect(res.status).toHaveBeenCalledWith(403);
            }
          }
        )
      );
    });
  });
});
