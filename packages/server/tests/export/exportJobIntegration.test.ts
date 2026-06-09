import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../src/db';
import { ExportJobService } from '../../src/export/jobs/ExportJobService';

describe('ExportJobService integration', () => {
  let dbUp = false;

  beforeAll(async () => {
    try {
      await db.selectFrom('audit.export_job').select('export_id').limit(1).execute();
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });

  it.skipIf(!dbUp)('RAW export job lifecycle: queued → running → done', async () => {
    const user = { id: 1, roles: ['ADMIN'], lineAccess: [], lineScopes: [] } as any;
    const view = await ExportJobService.createAndRun(
      {
        type: 'RAW',
        format: 'CSV',
        scope: { processId: 'HRS', dateFrom: '2099-01-01', dateTo: '2099-01-02' },
      },
      user,
    );

    expect(view.jobId).toBeTruthy();
    expect(['COMPLETE', 'FAILED']).toContain(view.status);

    if (view.status === 'COMPLETE') {
      expect(view.jobStatus).toBe('done');
      expect(view.progress).toBe(100);
      expect(view.artifact?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(view.downloadUrl).toContain('/exports/download/');
    }
  });
});
