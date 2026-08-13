import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { AuthUser } from '../src/services/authService';

const flags: Record<string, boolean> = { 'mode.manual_reroll': true };

vi.mock('../src/context', () => ({
  getTenantId: () => '00000000-0000-0000-0000-000000000001',
}));

vi.mock('../src/platform/tenantConfig', () => ({
  getTenantModuleConfig: async () => ({ flags, enabledModules: ['M1'] }),
}));

const mockStart = vi.fn();
const mockPrepare = vi.fn();
const mockStartPrepared = vi.fn();
const mockCapture = vi.fn();
const mockEnd = vi.fn();
const mockCancel = vi.fn();
const mockList = vi.fn();
const mockActive = vi.fn();
const mockSummary = vi.fn();
const mockClaimed = vi.fn(async () => new Set<string>());
const mockGetById = vi.fn();

vi.mock('../src/services/ManualRerollService', () => ({
  ACTIVE_REROLL_CONFLICT: 'ACTIVE_REROLL_CONFLICT',
  ManualRerollService: {
    prepareSession: (...args: unknown[]) => mockPrepare(...args),
    startPreparedSession: (...args: unknown[]) => mockStartPrepared(...args),
    startSession: (...args: unknown[]) => mockStart(...args),
    updateCapture: (...args: unknown[]) => mockCapture(...args),
    getSessionById: (...args: unknown[]) => mockGetById(...args),
    endSession: (...args: unknown[]) => mockEnd(...args),
    cancelSession: (...args: unknown[]) => mockCancel(...args),
    listSessions: (...args: unknown[]) => mockList(...args),
    listQueueSessions: (...args: unknown[]) => mockList(...args),
    listClaimedBatchNumbers: (...args: unknown[]) => mockClaimed(...args),
    getActiveSession: (...args: unknown[]) => mockActive(...args),
    getProductionSummary: (...args: unknown[]) => mockSummary(...args),
    getOverlay: vi.fn(async () => []),
    holdSession: vi.fn(),
    resumeSession: vi.fn(),
  },
}));

vi.mock('../src/services/ShiftDetectionService', () => ({
  ShiftDetectionService: {
    getCurrentShift: vi.fn(async () => ({ shiftCode: 'A', prodDate: '2026-08-05' })),
  },
}));

const mockExecute = vi.fn();
const mockExecuteTakeFirst = vi.fn();
vi.mock('../src/db', () => ({
  db: {
    selectFrom: () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.innerJoin = self;
      chain.leftJoin = self;
      chain.select = self;
      chain.where = self;
      chain.orderBy = self;
      chain.limit = self;
      chain.execute = (...args: unknown[]) => mockExecute(...args);
      chain.executeTakeFirst = (...args: unknown[]) => mockExecuteTakeFirst(...args);
      return chain;
    },
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

import manualRerollRoutes from '../src/routes/manualRerollRoutes';

const app = express();
app.use(express.json());
app.use('/manual-reroll', manualRerollRoutes);

describe('manualRerollRoutes auth matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags['mode.manual_reroll'] = true;
    currentUser = {
      id: 10,
      username: 'op6hi',
      roles: ['OPERATOR'],
      lineAccess: ['6HI'],
      lineScopes: [{ code: '6HI', accessLevel: 'WRITE' }],
      machineAccess: ['6HI'],
    };
    mockExecute.mockResolvedValue([]);
    mockExecuteTakeFirst.mockResolvedValue({
      order_id: '99',
      batch_number: 'B-1',
      coil_no: 'C-1',
      status: 'PENDING',
      customer_name: 'Acme',
      machine_code: '6HI',
      grade_code: 'G1',
      ppc_weight_mt: '2.5',
    });
    mockPrepare.mockResolvedValue({ sessionId: '1', status: 'PREPARING', passes: [] });
    mockStartPrepared.mockResolvedValue({ sessionId: '1', status: 'IN_PROGRESS', passes: [] });
    mockCapture.mockResolvedValue({ sessionId: '1', status: 'IN_PROGRESS', actualWeightMt: 2.5, passes: [] });
    mockList.mockResolvedValue([]);
    mockActive.mockResolvedValue(null);
    mockClaimed.mockResolvedValue(new Set());
    mockSummary.mockResolvedValue({ totalRerollMt: 0, sessionCount: 0 });
  });

  it('returns 403 when the tenant flag is off', async () => {
    flags['mode.manual_reroll'] = false;
    const res = await request(app).get('/manual-reroll/sessions?machine=6HI');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Feature disabled/);
  });

  it('returns 403 when the operator has no machine access', async () => {
    currentUser = { ...currentUser, machineAccess: ['4HI'], lineAccess: ['4HI'], lineScopes: [] };
    const res = await request(app).get('/manual-reroll/sessions?machine=6HI');
    expect(res.status).toBe(403);
  });

  it('allows operator write prepare', async () => {
    const res = await request(app).post('/manual-reroll/sessions').send({
      machine: '6HI',
      batchNumber: 'B-1',
      rerollQuantity: 1.5,
    });
    expect(res.status).toBe(201);
    expect(mockPrepare).toHaveBeenCalled();
    expect(res.body.status).toBe('PREPARING');
  });

  it('prepares without a client weight and uses ppc weight', async () => {
    const res = await request(app).post('/manual-reroll/sessions').send({
      machine: '6HI',
      batchNumber: 'B-1',
    });
    expect(res.status).toBe(201);
    expect(mockPrepare.mock.calls[0][0].rerollQuantity).toBe(2.5);
  });

  it('starts a prepared session', async () => {
    const res = await request(app).post('/manual-reroll/sessions/1/start').send({ machine: '6HI' });
    expect(res.status).toBe(200);
    expect(mockStartPrepared).toHaveBeenCalledWith('1');
  });

  it('saves capture payload', async () => {
    const res = await request(app).patch('/manual-reroll/sessions/1/capture').send({
      machine: '6HI',
      actualWeightMt: 2.5,
      passes: [{ passNo: 1, thicknessMm: 1.1 }],
    });
    expect(res.status).toBe(200);
    expect(mockCapture).toHaveBeenCalled();
  });

  it('allows admin write prepare', async () => {
    currentUser = {
      id: 1,
      username: 'admin',
      roles: ['ADMIN'],
      lineAccess: [],
      lineScopes: [],
      machineAccess: [],
    };
    const res = await request(app).post('/manual-reroll/sessions').send({
      machine: '6HI',
      batchNumber: 'B-1',
      rerollQuantity: 1.5,
    });
    expect(res.status).toBe(201);
  });

  it('rejects machine-head write', async () => {
    currentUser = {
      id: 3,
      username: 'mh',
      roles: ['MACHINE_HEAD'],
      lineAccess: ['6HI'],
      lineScopes: [{ code: '6HI', accessLevel: 'WRITE' }],
      machineAccess: ['6HI'],
    };
    const res = await request(app).post('/manual-reroll/sessions').send({
      machine: '6HI',
      batchNumber: 'B-1',
      rerollQuantity: 1.5,
    });
    expect(res.status).toBe(403);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('allows machine-head read', async () => {
    currentUser = {
      id: 3,
      username: 'mh',
      roles: ['MACHINE_HEAD'],
      lineAccess: ['6HI'],
      lineScopes: [{ code: '6HI', accessLevel: 'WRITE' }],
      machineAccess: ['6HI'],
    };
    const res = await request(app).get('/manual-reroll/sessions?machine=6HI');
    expect(res.status).toBe(200);
  });

  it('allows supervisor and plant-head read', async () => {
    for (const role of ['SUPERVISOR', 'PLANT_HEAD'] as const) {
      currentUser = {
        id: 8,
        username: role.toLowerCase(),
        roles: [role],
        lineAccess: [],
        lineScopes: [],
        machineAccess: [],
      };
      const res = await request(app).get('/manual-reroll/summary?machine=6HI&from=2026-08-05&to=2026-08-05');
      expect(res.status).toBe(200);
    }
  });

  it('maps production conflict to 409', async () => {
    mockPrepare.mockRejectedValue(new Error('ACTIVE_ORDER_CONFLICT:LIVE-9'));
    const res = await request(app).post('/manual-reroll/sessions').send({
      machine: '6HI',
      batchNumber: 'B-1',
      rerollQuantity: 1.5,
    });
    expect(res.status).toBe(409);
    expect(res.body.activeBatchNumber).toBe('LIVE-9');
  });

  it('omits claimed COMPLETED batches from the pending queue', async () => {
    mockExecute.mockResolvedValue([
      {
        order_id: '1',
        batch_number: 'DONE-1',
        coil_no: 'C-1',
        status: 'PENDING',
        customer_name: 'Acme',
        machine_code: '6HI',
        grade_code: 'G1',
        ppc_weight_mt: '1',
        slit_id: null,
        roll_finish: null,
        sub_process: 'ROLLING',
        ppc_thk_mm: null,
        width_mm: null,
      },
      {
        order_id: '2',
        batch_number: 'OPEN-1',
        coil_no: 'C-2',
        status: 'PENDING',
        customer_name: 'Acme',
        machine_code: '6HI',
        grade_code: 'G1',
        ppc_weight_mt: '2',
        slit_id: null,
        roll_finish: null,
        sub_process: 'ROLLING',
        ppc_thk_mm: null,
        width_mm: null,
      },
    ]);
    mockClaimed.mockResolvedValue(new Set(['DONE-1']));
    const res = await request(app).get('/manual-reroll/queue?machine=6HI');
    expect(res.status).toBe(200);
    expect(res.body.pending.map((p: { batchNumber: string }) => p.batchNumber)).toEqual(['OPEN-1']);
  });

  it('returns 4HI pending plans that have no crm_order yet', async () => {
    currentUser = {
      ...currentUser,
      machineAccess: ['4HI'],
      lineAccess: ['4HI'],
      lineScopes: [{ code: '4HI', accessLevel: 'WRITE' }],
    };
    mockExecute.mockResolvedValue([
      {
        order_id: null,
        batch_number: '4HI-PLAN-1',
        coil_no: 'C-4',
        status: null,
        customer_name: 'Acme',
        machine_code: '4HI',
        grade_code: 'G1',
        ppc_weight_mt: '3',
        slit_id: null,
        roll_finish: null,
        sub_process: 'ROLLING',
        ppc_thk_mm: null,
        width_mm: null,
      },
    ]);
    const res = await request(app).get('/manual-reroll/queue?machine=4HI');
    expect(res.status).toBe(200);
    expect(res.body.pending).toEqual([
      expect.objectContaining({ batchNumber: '4HI-PLAN-1', orderId: '4HI-PLAN-1', status: 'PENDING' }),
    ]);
  });

  it('rejects prepare when batch already has a completed re-roll session', async () => {
    mockClaimed.mockResolvedValue(new Set(['B-1']));
    const res = await request(app).post('/manual-reroll/sessions').send({
      machine: '6HI',
      batchNumber: 'B-1',
      rerollQuantity: 1.5,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/completed Manual Re-Roll/i);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('rejects 2HI machine with 400', async () => {
    const res = await request(app).post('/manual-reroll/sessions').send({
      machine: '2HI',
      batchNumber: 'B-1',
      rerollQuantity: 1.5,
    });
    expect(res.status).toBe(400);
    expect(mockPrepare).not.toHaveBeenCalled();
  });
});
