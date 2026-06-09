import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { requireRole, requireLineAccess } from '../../src/middleware/authMiddleware';

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
            // Mock req.body.processLine as the target
            const req: any = { 
              user: { roles: userRoles, lineAccess },
              body: { processLine: requestedLine },
              params: {},
              query: {}
            };
            const res = mockRes();
            const next = vi.fn();

            const middleware = requireLineAccess(operation as any);
            middleware(req, res, next);

            let hasLineAccess = lineAccess.includes(requestedLine) || userRoles.includes('ADMIN');
            if (operation === 'READ' && userRoles.includes('PLANT_HEAD')) {
              hasLineAccess = true;
            }
            
            let hasRoleAccess = false;
            if (operation === 'READ') hasRoleAccess = true;
            if (operation === 'WRITE') hasRoleAccess = userRoles.some(r => ['OPERATOR', 'SUPERVISOR', 'ADMIN'].includes(r));
            if (operation === 'APPROVE') hasRoleAccess = userRoles.some(r => ['SUPERVISOR', 'PLANT_HEAD', 'ADMIN'].includes(r));

            if (hasLineAccess && hasRoleAccess) {
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
