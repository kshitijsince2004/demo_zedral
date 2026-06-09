import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { getDb } from '../../src/db';

vi.mock('../../src/middleware/authMiddleware', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { 
      id: 123, 
      roles: ['OPERATOR'], 
      lineAccess: ['HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'],
      lineScopes: ['HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'].map(code => ({ code, accessLevel: 'WRITE' }))
    };
    next();
  },
  requireRole: () => (req: any, res: any, next: any) => next(),
  requireLineAccess: () => (req: any, res: any, next: any) => next()
}));

vi.mock('../../src/services/shiftLogAccessService', () => ({
  assertShiftLogAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/authService', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    validateBadgePin: vi.fn().mockResolvedValue({ id: 99, username: 'incoming-op' }),
  };
});

vi.mock('../../src/services/shiftLogService', () => ({
  ShiftLogService: {
    create: vi.fn().mockResolvedValue('mock-shift-log-123'),
    getById: vi.fn().mockResolvedValue({ shift_log_id: 'mock-shift-log-123', state: 'DRAFT', process_id: 1 }),
    submit: vi.fn().mockResolvedValue(true),
    approve: vi.fn().mockResolvedValue(true),
    reopen: vi.fn().mockResolvedValue(true),
    handover: vi.fn().mockResolvedValue('mock-new-shift-log-456'),
    getHandoverSummary: vi.fn().mockResolvedValue({
      shiftLogId: 'mock-shift-log-123',
      openCoilCount: 0,
      runningStoppageCount: 0,
      producedMt: 0,
      targetMt: 500,
      openCoils: [],
      runningStoppages: [],
      nextShift: { shiftCode: 'B', prodDate: new Date() },
      notes: '',
    }),
  },
}));

vi.mock('../../src/services/processServices', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    HRSService: {
      createEntry: vi.fn().mockResolvedValue('mock-hrs-entry-123')
    }
  };
});

import entriesRoutes from '../../src/routes/entriesRoutes';
import shiftLogRoutes from '../../src/routes/shiftLogRoutes';
import syncRoutes from '../../src/routes/syncRoutes';
import shiftHandoverRoutes from '../../src/routes/shiftHandoverRoutes';
import { domainEvents } from '../../src/services/DomainEventPublisher';

const app = express();
app.use(express.json());
app.use('/shift-logs', shiftLogRoutes);
app.use('/entries', entriesRoutes);
app.use('/sync', syncRoutes);
app.use('/handovers', shiftHandoverRoutes);

describe('E2E Shift Log Lifecycle (Wave 18)', () => {
  let createdShiftLogId: string;
  let eventSpy: any;

  beforeAll(async () => {
    eventSpy = vi.spyOn(domainEvents, 'publish');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1. Should create a new Shift Log', async () => {
    const res = await request(app)
      .post('/shift-logs')
      .send({
        processLine: 'HRS',
        shiftCode: 'A',
        crewTargetMt: 500
      });
    
    // In our mocked setup, shiftLogRoutes might not actually insert without full dependencies,
    // but assuming standard REST behavior:
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    createdShiftLogId = res.body.id;
  });

  it('2. Should validate and create an HRS entry via offline batch sync, firing Domain Events', async () => {
    const validOfflinePayload = {
      shiftLogId: createdShiftLogId,
      processCode: 'HRS',
      coil_no: 'COIL-TEST-123',
      nominal_width: 1250,
      actual_width: 1248,
      thickness: 2.0,
      weight_mt: 25.0,
      scrap_mt: 0.5,
      time_from: new Date().toISOString(),
      time_to: new Date().toISOString(),
      slit_slots: []
    };

    const batchRequest = {
      items: [
        {
          timestamp: Date.now(),
          url: '/entries/HRS',
          method: 'POST',
          payload: validOfflinePayload
        }
      ]
    };

    const res = await request(app)
      .post('/sync/batch')
      .send(batchRequest);

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(1);
    expect(res.body.results[0].status).toBe('SUCCESS');
    // Verify Domain Event was fired inside the sync route
    expect(eventSpy).toHaveBeenCalledWith('ENTRY_SYNCED', expect.objectContaining({
      entryId: res.body.results[0].id
    }));
  });

  it('3. Should reject invalid payloads via the Shared Validation Engine (Online Mode)', async () => {
    const invalidPayload = {
      shiftLogId: createdShiftLogId,
      coil_no: 'COIL-TEST-124',
      nominal_width: 1250,
      // actual_width missing to trigger Zod schema block
      thickness: 2.0,
      weight_mt: -5, // Negative weight 
      scrap_mt: 0.5,
      time_from: new Date().toISOString(),
      time_to: new Date().toISOString()
    };

    const res = await request(app)
      .post('/entries/HRS')
      .send(invalidPayload);

    // Should return 400 Bad Request directly
    expect(res.status).toBe(400);
    expect(res.body.validationResult.isValid).toBe(false);
    expect(res.body.validationResult.errors.length).toBeGreaterThan(0);
  });

  it('4. Should submit the shift log for review', async () => {
    const res = await request(app)
      .put(`/shift-logs/${createdShiftLogId}/submit`)
      .send({});
      
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('5. Should return handover summary for outgoing shift', async () => {
    const res = await request(app).get(`/shift-logs/${createdShiftLogId}/handover/summary`);
    expect(res.status).toBe(200);
    expect(res.body.shiftLogId).toBeDefined();
  });

  it('6. Should complete shift handover with incoming operator attestation', async () => {
    const res = await request(app)
      .post(`/shift-logs/${createdShiftLogId}/handover`)
      .send({ incomingBadge: '3344', incomingPin: '4321', notes: 'All open coils noted' });

    expect(res.status).toBe(200);
    expect(res.body.newShiftLogId).toBeDefined();
  });
});
