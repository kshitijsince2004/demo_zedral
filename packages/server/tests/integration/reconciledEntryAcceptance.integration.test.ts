import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../src/middleware/authMiddleware', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { id: 'mock-operator-123', roles: ['OPERATOR'], lineAccess: ['HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'] };
    next();
  },
  requireRole: () => (req: any, res: any, next: any) => next(),
  requireLineAccess: () => (req: any, res: any, next: any) => next()
}));

vi.mock('../../src/services/processServices', () => ({
  HRSService: { createEntry: vi.fn().mockResolvedValue('hrs-123') },
  PKLService: { createEntry: vi.fn().mockResolvedValue('pkl-123'), createChartEntry: vi.fn().mockResolvedValue('pkl-chart-123') },
  CRMService: { createEntry: vi.fn().mockResolvedValue('crm-123') },
  ANNService: { createEntry: vi.fn().mockResolvedValue('ann-123') },
  SKPService: { createEntry: vi.fn().mockResolvedValue('skp-123') },
  RWDService: { createEntry: vi.fn().mockResolvedValue('rwd-123') },
  CRSService: { createEntry: vi.fn().mockResolvedValue('crs-123') },
  CTLService: { createEntry: vi.fn().mockResolvedValue('ctl-123') }
}));

import entriesRoutes from '../../src/routes/entriesRoutes';
import { domainEvents } from '../../src/services/DomainEventPublisher';

const app = express();
app.use(express.json());
app.use('/entries', entriesRoutes);

describe('15.2 Integration Test: Reconciled-entry acceptance', () => {
  let eventSpy: any;

  beforeAll(() => {
    eventSpy = vi.spyOn(domainEvents, 'publish');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should submit reconciled entries for representative processes and assert the server endpoints accept them', async () => {
    const shiftLogId = 'mock-shift-log-id-456';

    const payloads: Record<string, any> = {
      HRS: {
        id: 'entry-hrs-1',
        shiftLogId,
        coilNo: 'COIL-HRS-001',
        timeFrom: '10:00',
        timeTo: '11:00',
        nominalWidthMm: 1250,
        actualWidthMm: 1248,
        nominalThkMm: 2.0,
        weightMt: 25.0,
        scrapMt: 0.5,
        slitSlots: []
      },
      PKL: {
        id: 'entry-pkl-1',
        shiftLogId,
        coilNo: 'COIL-PKL-001',
        timeFrom: '11:00',
        timeTo: '12:00',
        widthMm: 1248,
        thkMm: 2.0,
        weightMt: 24.5,
        lineSpeedMpm: 45,
        heatNo: 'HEAT-999',
        source: 'INTERNAL'
      },
      CRM: {
        id: 'entry-crm-1',
        shiftLogId,
        coilNo: 'COIL-CRM-001',
        timeFrom: '12:00',
        timeTo: '13:00',
        widthMm: 1248,
        inputThkMm: 2.0,
        outputThkMm: 1.0,
        weightMt: 24.5
      },
      ANN: {
        id: 'entry-ann-1',
        shiftLogId,
        coilNo: 'COIL-ANN-001',
        timeFrom: '13:00',
        timeTo: '14:00',
        chargeNo: 'CHARGE-88',
        baseNo: 'BASE-1',
        furnaceId: 1,
        gradeCode: 'GRADE-A',
        noOfCoils: 3
      },
      SKP: {
        id: 'entry-skp-1',
        shiftLogId,
        coilNo: 'COIL-SKP-001',
        timeFrom: '14:00',
        timeTo: '15:00',
        widthMm: 1248,
        thkMm: 1.0,
        finalThkMm: 0.98,
        weightMt: 24.5,
        surfaceFinish: 'MATT',
        reRolling: false,
        passes: [{ passNo: 1, thicknessMm: 0.99 }, { passNo: 2, thicknessMm: 0.98 }]
      },
      RWD: {
        id: 'entry-rwd-1',
        shiftLogId,
        coilNo: 'COIL-RWD-001',
        timeFrom: '15:00',
        timeTo: '16:00',
        widthMm: 1248,
        thkMm: 0.98,
        outputThkMm: 0.97,
        weightMt: 24.5,
        surfaceFinish: 'MATT'
      },
      CRS: {
        id: 'entry-crs-1',
        shiftLogId,
        coilNo: 'COIL-CRS-001',
        timeFrom: '16:00',
        timeTo: '17:00',
        slitNo: 'SLIT-1',
        coilWidthMm: 1248,
        nominalThkMm: 0.97,
        outputWtMt: 24.5,
        slitSlots: []
      },
      CTL: {
        id: 'entry-ctl-1',
        shiftLogId,
        coilNo: 'COIL-CTL-001',
        timeFrom: '17:00',
        timeTo: '18:00',
        widthMm: 1248,
        thkMm: 0.97,
        weightMt: 24.5,
        nominalSetLengthMm: 2000,
        actualLengthMm: 2000,
        noPieces: 500,
        noBundles: 10,
        totalProdMt: 24.5,
        squarenessCheckDone: true
      }
    };

    for (const [processId, payload] of Object.entries(payloads)) {
      const res = await request(app)
        .post(`/entries/${processId}`)
        .send(payload);
      
      if (res.status !== 201) {
        console.log(`Failed to submit reconciled entry for ${processId}. Status: ${res.status}. Body:`, JSON.stringify(res.body, null, 2));
      }
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.validationResult.isValid).toBe(true);

      expect(eventSpy).toHaveBeenCalledWith('ENTRY_SAVED', expect.objectContaining({
        processId,
        shiftLogId
      }));
    }
  });
});
