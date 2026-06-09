import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/middleware/authMiddleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = {
      id: 2,
      roles: ['SUPERVISOR'],
      lineAccess: ['HRS', 'PKL'],
      lineScopes: [
        { code: 'HRS', accessLevel: 'READ' },
        { code: 'PKL', accessLevel: 'READ' },
      ],
    };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

const mockCreateFromRequest = vi.fn();
const mockGetJobView = vi.fn();
const mockListJobs = vi.fn();

vi.mock('../src/export/jobs/ExportJobService', () => ({
  ExportJobService: {
    listJobs: (...args: unknown[]) => mockListJobs(...args),
  },
  parseExportRequest: (body: Record<string, unknown>) => body,
}));

vi.mock('../src/services/ExportService', () => ({
  ExportService: {
    createFromRequest: (...args: unknown[]) => mockCreateFromRequest(...args),
    getJobView: (...args: unknown[]) => mockGetJobView(...args),
    parseQueryParams: (query: Record<string, unknown>) => ({
      scope: {
        processId: query.process ? String(query.process) : undefined,
        dateFrom: query.date_from ? String(query.date_from) : undefined,
        dateTo: query.date_to ? String(query.date_to) : undefined,
        shiftCode: query.shift ? String(query.shift) : undefined,
        coilNo: query.coil_no ? String(query.coil_no) : undefined,
      },
      format: String(query.format || 'csv').toUpperCase() === 'XLSX' ? 'XLSX' : 'CSV',
    }),
    resolveDownload: vi.fn(),
  },
}));

import exportRoutes from '../src/routes/exportRoutes';

const app = express();
app.use(express.json());
app.use('/exports', exportRoutes);

describe('exportRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /exports creates an export job', async () => {
    mockCreateFromRequest.mockResolvedValue({
      jobId: '42',
      type: 'RAW',
      status: 'COMPLETE',
      jobStatus: 'done',
      progress: 100,
      downloadUrl: '/exports/download/42',
      rowCount: 10,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).post('/exports').send({
      scope: { processId: 'HRS', dateFrom: '2025-06-01' },
      format: 'CSV',
    });

    expect(res.status).toBe(201);
    expect(res.body.jobId).toBe('42');
    expect(res.body.rowCount).toBe(10);
    expect(res.body.type).toBe('RAW');
  });

  it('GET /exports accepts query params', async () => {
    mockCreateFromRequest.mockResolvedValue({
      jobId: '43',
      type: 'RAW',
      status: 'COMPLETE',
      jobStatus: 'done',
      progress: 100,
      downloadUrl: '/exports/download/43',
      rowCount: 0,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get('/exports?process=PKL&format=csv');
    expect(res.status).toBe(201);
    expect(mockCreateFromRequest).toHaveBeenCalled();
  });

  it('GET /exports?list=1 returns export history', async () => {
    mockListJobs.mockResolvedValue({
      jobs: [{ jobId: '1', type: 'RAW', status: 'COMPLETE' }],
      page: 1,
      limit: 20,
      total: 1,
      pages: 1,
    });

    const res = await request(app).get('/exports?list=1&type=RAW&from=2026-01-01');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(mockListJobs).toHaveBeenCalled();
  });

  it('GET /exports/:jobId returns job status', async () => {
    mockGetJobView.mockResolvedValue({
      jobId: '42',
      type: 'RAW',
      status: 'COMPLETE',
      jobStatus: 'done',
      progress: 100,
      downloadUrl: '/exports/download/42',
      rowCount: 5,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get('/exports/42');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETE');
    expect(res.body.jobStatus).toBe('done');
  });
});
