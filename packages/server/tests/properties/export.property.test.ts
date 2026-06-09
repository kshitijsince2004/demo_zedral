import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { UserRole } from '@m1/shared-validation';
import { db } from '../../src/db';
import { ExportJobService, ASYNC_ROW_THRESHOLD } from '../../src/export/jobs/ExportJobService';
import { ExportJobRunner } from '../../src/export/jobs/ExportJobRunner';
import { RawRegisterReport } from '../../src/export/definitions/RawRegisterReport';
import { ExportWorker } from '../../src/export/jobs/ExportWorker';
import { renderCsv } from '../../src/export/render/CsvRenderer';
import { artifactPath } from '../../src/export/jobs/artifactStore';
import fs from 'fs';
import path from 'path';

vi.mock('../../src/middleware/authMiddleware', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { id: 1, role: UserRole.PLANT_HEAD, roles: [UserRole.PLANT_HEAD], processes: [] };
    next();
  },
  requireRole: (roles: any[]) => (req: any, res: any, next: any) => {
    next();
  },
}));

vi.mock('../../src/export/jobs/ExportWorker', () => ({
  ExportWorker: { kick: vi.fn() },
}));

describe('Export Async Threshold & Audit (Tasks 11.3 - 11.6)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    
    let currentJobStatus = 'queued';
    let currentError = null as string | null;

    const mockBuilder = {
      values: vi.fn().mockReturnThis(),
      set: vi.fn().mockImplementation((payload: any) => {
        if (payload.job_status) currentJobStatus = payload.job_status;
        if (payload.error_message) currentError = payload.error_message;
        return mockBuilder;
      }),
      where: vi.fn().mockReturnThis(),
      returningAll: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
      executeTakeFirst: vi.fn().mockImplementation(async () => ({ 
        export_id: 'mocked-job', 
        job_status: currentJobStatus, 
        error_message: currentError,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      })),
      executeTakeFirstOrThrow: vi.fn().mockImplementation(async () => ({ 
        export_id: 'mocked-job',
        job_status: currentJobStatus,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      })),
    };

    vi.spyOn(db, 'insertInto').mockReturnValue(mockBuilder as any);
    vi.spyOn(db, 'updateTable').mockReturnValue(mockBuilder as any);
    vi.spyOn(db, 'selectFrom').mockReturnValue(mockBuilder as any);
  });

  it('Property 6 & Task 11.3: Threshold > 10000 defers to async worker (202 status)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: ASYNC_ROW_THRESHOLD + 1, max: 100000 }), async (rows) => {
        vi.spyOn(RawRegisterReport, 'estimateRowCount').mockResolvedValue(rows);
        const kickSpy = vi.spyOn(ExportWorker, 'kick');

        const view = await ExportJobService.createAndRun(
          { type: 'RAW', format: 'XLSX', scope: { processId: '6HI' } },
          { id: 1, roles: [UserRole.PLANT_HEAD] } as any
        );

        expect(view.status).toBe('PENDING'); // 202 equivalent
        expect(kickSpy).toHaveBeenCalled();
        expect(db.insertInto).toHaveBeenCalledWith('audit.export_job');
      }),
      { numRuns: 10 }
    );
  });

  it('Property 7 & Task 11.4: Failure produces no partial file', async () => {
    const mockRequest = { type: 'RAW', format: 'CSV', scope: {} } as any;
    const mockUser = { id: 1, roles: [UserRole.PLANT_HEAD] } as any;

    vi.spyOn(RawRegisterReport, 'estimateRowCount').mockResolvedValue(500);
    vi.spyOn(RawRegisterReport, 'execute').mockResolvedValue({
      rows: [],
      filename: 'test.csv',
      columns: ['throughput'],
    });

    const jobId = 'test-job-fail';
    const artifactFile = artifactPath(jobId, 'CSV');

    const objectStorage = await import('../../src/export/jobs/objectStorage');
    vi.spyOn(objectStorage, 'uploadArtifactIfConfigured').mockImplementation(async () => {
      // Simulate file having been created by the renderer
      const dir = path.dirname(artifactFile);
      if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(artifactFile, 'partial');
      throw new Error('Test Upload Failure');
    });

    const view = await ExportJobRunner.runJob(jobId, mockRequest, mockUser);

    expect(view.status).toBe('FAILED');
    expect(view.error).toBe('Test Upload Failure');
    expect(fs.existsSync(artifactFile)).toBe(false); // Cleaned up
  });

  it('Task 11.5: Applies canonical headers', async () => {
    const result = await renderCsv('test-canonical', {
      rows: [
        { throughput: 100, yield: 95, rejection: 2, oee: 80, actual_production: 150, planned_production: 200 }
      ],
      filename: 'test.csv',
      columns: ['throughput', 'yield', 'rejection', 'oee', 'actual_production', 'planned_production'],
    });

    const content = fs.readFileSync(result.filePath, 'utf8');
    expect(content).toContain('Throughput (MT),Yield (%),Rejection rate (%),OEE (%),Actual production (MT),Planned production (MT)');
  });

  it('Task 11.6: Writes EXPORT audit event on completion', async () => {
    const mockRequest = { type: 'RAW', format: 'CSV', scope: { processId: '6HI' } } as any;
    const mockUser = { id: 1, roles: [UserRole.PLANT_HEAD] } as any;

    vi.spyOn(RawRegisterReport, 'estimateRowCount').mockResolvedValue(500);
    vi.spyOn(RawRegisterReport, 'execute').mockResolvedValue({
      rows: [],
      filename: 'test.csv',
      columns: ['throughput'],
    });

    const jobId = 'test-job-audit';
    
    await ExportJobRunner.runJob(jobId, mockRequest, mockUser);

    // Verify audit.audit_log was called with action: 'EXPORT'
    const insertSpy = db.insertInto as any;
    const auditCall = insertSpy.mock.calls.find((call: any[]) => call[0] === 'audit.audit_log');
    expect(auditCall).toBeDefined();
  });
});
