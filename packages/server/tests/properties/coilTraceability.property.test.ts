import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import express from 'express';
import { UserRole } from '@m1/shared-validation';

vi.mock('../../src/middleware/authMiddleware', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { userId: 1, role: UserRole.PLANT_HEAD, processes: [] };
    next();
  },
  requireRole: (roles: any[]) => (req: any, res: any, next: any) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

import reportRoutes from '../../src/routes/reportRoutes';
import { ReportingService } from '../../src/services/ReportingService';

const app = express();
app.use('/', reportRoutes);

describe('Property Test: Coil Traceability Validation (P4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Property 4: Coil-number validation precedes search', async () => {
    const searchSpy = vi.spyOn(ReportingService, 'searchCoilTraceability').mockResolvedValue({
      found: false,
      coilNo: '',
      genealogy: null,
    });

    await fc.assert(
      fc.asyncProperty(
        fc.string().filter((s) => !s.trim() || s.trim().length > 64),
        async (invalidCoilNo) => {
          searchSpy.mockClear();

          const res = await request(app)
            .get('/coil-traceability')
            .query({ coilNo: invalidCoilNo });

          expect(res.status).toBe(400);
          expect(res.body.error).toBe('INVALID_COIL_NUMBER');
          expect(searchSpy).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns no-match result when coil is valid but not found', async () => {
    const searchSpy = vi.spyOn(ReportingService, 'searchCoilTraceability').mockResolvedValue({
      found: false,
      coilNo: 'MISSING-COIL',
      genealogy: null,
    });

    const res = await request(app)
      .get('/coil-traceability')
      .query({ coilNo: 'MISSING-COIL' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      found: false,
      coilNo: 'MISSING-COIL',
      genealogy: null,
    });
    expect(searchSpy).toHaveBeenCalledWith('MISSING-COIL');
  });
});
