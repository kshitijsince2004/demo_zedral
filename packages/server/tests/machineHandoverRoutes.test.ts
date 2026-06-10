import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { AuthUser } from '../src/services/authService';

const mockGetHandoverForAccess = vi.fn();
const mockAcceptHandover = vi.fn();
const mockRequestClarification = vi.fn();

vi.mock('../src/services/MachineHandoverService', () => ({
  MachineHandoverService: {
    getHandoverForAccess: (...args: unknown[]) => mockGetHandoverForAccess(...args),
    acceptHandover: (...args: unknown[]) => mockAcceptHandover(...args),
    requestClarification: (...args: unknown[]) => mockRequestClarification(...args),
  },
}));

let currentUser: AuthUser = {
  id: 10,
  username: 'op6hi',
  roles: ['OPERATOR'],
  lineAccess: ['6HI'],
  lineScopes: [{ code: '6HI', accessLevel: 'WRITE' }],
  machineAccess: ['6HI'],
};

vi.mock('../src/middleware/authMiddleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = currentUser;
    next();
  },
}));

import machineHandoverRoutes from '../src/routes/machineHandoverRoutes';

const app = express();
app.use(express.json());
app.use('/machines/handover', machineHandoverRoutes);

const HANDOVER_6HI = {
  handover_id: 'h-6hi-1',
  machine_code: '6HI',
  status: 'PENDING',
};

const HANDOVER_4HI = {
  handover_id: 'h-4hi-1',
  machine_code: '4HI',
  status: 'PENDING',
};

describe('machineHandoverRoutes authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      id: 10,
      username: 'op6hi',
      roles: ['OPERATOR'],
      lineAccess: ['6HI'],
      lineScopes: [{ code: '6HI', accessLevel: 'WRITE' }],
      machineAccess: ['6HI'],
    };
  });

  describe('POST /accept/:handoverId', () => {
    it('allows accept when user is assigned to the handover machine', async () => {
      mockGetHandoverForAccess.mockResolvedValue(HANDOVER_6HI);
      mockAcceptHandover.mockResolvedValue({ ...HANDOVER_6HI, status: 'ACCEPTED' });

      const res = await request(app).post('/machines/handover/accept/h-6hi-1').send({});

      expect(res.status).toBe(200);
      expect(mockAcceptHandover).toHaveBeenCalledWith('h-6hi-1', 10);
    });

    it('returns 403 when user has no access to the handover machine', async () => {
      mockGetHandoverForAccess.mockResolvedValue(HANDOVER_4HI);

      const res = await request(app).post('/machines/handover/accept/h-4hi-1').send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Forbidden: No access to machine 4HI/);
      expect(mockAcceptHandover).not.toHaveBeenCalled();
    });

    it('returns 403 on cross-machine acceptance (6HI user accepting 4HI handover)', async () => {
      currentUser = {
        id: 11,
        username: 'op6hi',
        roles: ['OPERATOR'],
        lineAccess: ['6HI'],
        lineScopes: [{ code: '6HI', accessLevel: 'WRITE' }],
        machineAccess: ['6HI'],
      };
      mockGetHandoverForAccess.mockResolvedValue(HANDOVER_4HI);

      const res = await request(app).post('/machines/handover/accept/h-4hi-1').send({});

      expect(res.status).toBe(403);
      expect(mockAcceptHandover).not.toHaveBeenCalled();
    });

    it('returns 404 when handover does not exist', async () => {
      mockGetHandoverForAccess.mockResolvedValue(undefined);

      const res = await request(app).post('/machines/handover/accept/missing').send({});

      expect(res.status).toBe(404);
      expect(mockAcceptHandover).not.toHaveBeenCalled();
    });
  });

  describe('POST /clarification/:handoverId', () => {
    it('allows clarification when user is assigned to the handover machine', async () => {
      mockGetHandoverForAccess.mockResolvedValue(HANDOVER_6HI);
      mockRequestClarification.mockResolvedValue({
        ...HANDOVER_6HI,
        status: 'CLARIFICATION_REQUESTED',
      });

      const res = await request(app)
        .post('/machines/handover/clarification/h-6hi-1')
        .send({ notes: 'Need details on stoppage root cause' });

      expect(res.status).toBe(200);
      expect(mockRequestClarification).toHaveBeenCalledWith(
        'h-6hi-1',
        10,
        'Need details on stoppage root cause',
      );
    });

    it('returns 403 when user is not assigned to the handover machine', async () => {
      mockGetHandoverForAccess.mockResolvedValue(HANDOVER_4HI);

      const res = await request(app)
        .post('/machines/handover/clarification/h-4hi-1')
        .send({ notes: 'Please clarify breakdown status' });

      expect(res.status).toBe(403);
      expect(mockRequestClarification).not.toHaveBeenCalled();
    });

    it('returns 403 when operator has empty machine scope', async () => {
      currentUser = {
        id: 12,
        username: 'unscoped',
        roles: ['OPERATOR'],
        lineAccess: [],
        lineScopes: [],
        machineAccess: [],
      };
      mockGetHandoverForAccess.mockResolvedValue(HANDOVER_6HI);

      const res = await request(app)
        .post('/machines/handover/clarification/h-6hi-1')
        .send({ notes: 'Need more info' });

      expect(res.status).toBe(403);
      expect(mockRequestClarification).not.toHaveBeenCalled();
    });
  });
});
