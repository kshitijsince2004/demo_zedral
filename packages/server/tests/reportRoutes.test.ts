import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/middleware/authMiddleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = {
      id: 1,
      roles: ['PLANT_HEAD'],
      lineAccess: ['HRS', 'PKL', 'CRM'],
      lineScopes: [],
    };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

const mockSupervisor = vi.fn();
const mockPlantHead = vi.fn();
const mockManagement = vi.fn();
const mockDaily = vi.fn();
const mockDrilldown = vi.fn();
const mockPlantHeadDrilldown = vi.fn();
const mockCoilSearch = vi.fn();

vi.mock('../src/services/ReportingService', () => ({
  ReportingService: {
    getSupervisorDashboard: (...args: unknown[]) => mockSupervisor(...args),
    getPlantHeadDashboard: (...args: unknown[]) => mockPlantHead(...args),
    getManagementDashboard: (...args: unknown[]) => mockManagement(...args),
    getDailyReport: (...args: unknown[]) => mockDaily(...args),
    getDrilldown: (...args: unknown[]) => mockDrilldown(...args),
    getPlantHeadDrilldown: (...args: unknown[]) => mockPlantHeadDrilldown(...args),
    searchCoilTraceability: (...args: unknown[]) => mockCoilSearch(...args),
  },
}));

vi.mock('../src/services/shiftLogService', () => ({
  ShiftLogService: {
    getHandoverSummary: vi.fn(),
  },
}));

import reportRoutes from '../src/routes/reportRoutes';

const app = express();
app.use(express.json());
app.use('/reports', reportRoutes);

describe('reportRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /reports/plant-head returns dashboard data with default window 7', async () => {
    mockPlantHead.mockResolvedValue({
      window: 7,
      generatedAt: '2025-06-01T12:00:00.000Z',
      plantWideOee: 82.5,
      oeeTarget: 80,
      oeeTrend: [{ date: 'Mon', oee: 80 }],
      productionVsPlan: [],
      qualityTrend: [],
      topDefects: [],
      downtimeDrivers: [],
      kpiStrip: {
        productionTodayMt: 0,
        productionTodayTrendPct: 0,
        oeePct: 82.5,
        oeeTrendPct: 0,
        availabilityPct: 0,
        availabilityTrendPct: 0,
        performancePct: 0,
        performanceTrendPct: 0,
        qualityPct: 0,
        qualityTrendPct: 0,
      },
    });

    const res = await request(app).get('/reports/plant-head');
    expect(res.status).toBe(200);
    expect(res.body.plantWideOee).toBe(82.5);
    expect(mockPlantHead).toHaveBeenCalledWith(7, { lines: undefined, shifts: undefined, grades: undefined, customers: undefined, coils: undefined });
  });

  it('GET /reports/plant-head passes window query param', async () => {
    mockPlantHead.mockResolvedValue({
      window: 30,
      generatedAt: '2025-06-01T12:00:00.000Z',
      plantWideOee: 75,
      oeeTarget: 80,
      oeeTrend: [],
      productionVsPlan: [],
      qualityTrend: [],
      topDefects: [],
      downtimeDrivers: [],
      kpiStrip: {
        productionTodayMt: 0,
        productionTodayTrendPct: 0,
        oeePct: 75,
        oeeTrendPct: 0,
        availabilityPct: 0,
        availabilityTrendPct: 0,
        performancePct: 0,
        performanceTrendPct: 0,
        qualityPct: 0,
        qualityTrendPct: 0,
      },
    });

    const res = await request(app).get('/reports/plant-head?window=30');
    expect(res.status).toBe(200);
    expect(mockPlantHead).toHaveBeenCalledWith(30, { lines: undefined, shifts: undefined, grades: undefined, customers: undefined, coils: undefined });
  });

  it('GET /reports/plant-head rejects invalid window without querying', async () => {
    const res = await request(app).get('/reports/plant-head?window=5');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_WINDOW');
    expect(mockPlantHead).not.toHaveBeenCalled();
  });

  it('GET /reports/plant-head/drilldown returns paginated envelope', async () => {
    mockPlantHeadDrilldown.mockResolvedValue({
      metric: 'production',
      window: 7,
      records: [{ lineId: 'HRS', actualMt: 100 }],
      total: 1,
      page: 1,
      pageSize: 500,
    });

    const res = await request(app).get('/reports/plant-head/drilldown?metric=production&window=7');
    expect(res.status).toBe(200);
    expect(res.body.metric).toBe('production');
    expect(mockPlantHeadDrilldown).toHaveBeenCalledWith('production', 7, 1);
  });

  it('GET /reports/plant-head/drilldown rejects missing metric', async () => {
    const res = await request(app).get('/reports/plant-head/drilldown');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_METRIC');
    expect(mockPlantHeadDrilldown).not.toHaveBeenCalled();
  });

  it('GET /reports/plant-head/drilldown rejects invalid metric', async () => {
    const res = await request(app).get('/reports/plant-head/drilldown?metric=yield');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_METRIC');
    expect(mockPlantHeadDrilldown).not.toHaveBeenCalled();
  });

  it('GET /reports/management accepts period query', async () => {
    mockManagement.mockResolvedValue({
      period: 'week',
      throughputMt: { current: 1000, previous: 900, changePct: 11.1 },
      oee: { current: 80, previous: 78, changePct: 2.6 },
      rejectionCost: { current: 1000, previous: 1200, changePct: -16.7 },
      onTimeDeliveryPct: { current: 95, previous: 94, changePct: 1.1 },
      yieldPct: { current: 96, previous: 95, changePct: 1.1 },
      downtimeMinutes: { current: 200, previous: 250, changePct: -20 },
    });

    const res = await request(app).get('/reports/management?period=week');
    expect(res.status).toBe(200);
    expect(mockManagement).toHaveBeenCalledWith('week');
    expect(res.body.period).toBe('week');
  });

  it('GET /reports/daily returns production summary', async () => {
    mockDaily.mockResolvedValue({
      date: '2025-06-01',
      totalProductionMt: 500,
      primeYieldPct: 94.2,
      shiftCount: 3,
      byLine: [],
    });

    const res = await request(app).get('/reports/daily?date=2025-06-01');
    expect(res.status).toBe(200);
    expect(res.body.totalProductionMt).toBe(500);
    expect(mockDaily).toHaveBeenCalledWith('2025-06-01');
  });

  it('GET /reports/coil-traceability requires coilNo', async () => {
    const res = await request(app).get('/reports/coil-traceability');
    expect(res.status).toBe(400);
  });

  it('GET /reports/coil-traceability returns search results', async () => {
    mockCoilSearch.mockResolvedValue([
      {
        coilNo: 'COIL-001',
        grade: 'CRCA',
        customer: 'Hero',
        currentProcess: 'CRM',
        status: 'ACTIVE',
        weightMt: 12.5,
      },
    ]);

    const res = await request(app).get('/reports/coil-traceability?coilNo=COIL-001');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].coilNo).toBe('COIL-001');
  });
});
