import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { uniqueByBatchId } from '../src/reporting/plantHeadBacklog';

describe('plantHeadBacklog shared query', () => {
  it('uniqueByBatchId collapses join fan-out so one batch is never counted twice', () => {
    const rows = [
      { batch_id: 1, machine_name: 'A' },
      { batch_id: 1, machine_name: 'A-dup' },
      { batch_id: 2, machine_name: 'B' },
      { batch_id: '1', machine_name: 'A-again' },
    ];
    const deduped = uniqueByBatchId(rows);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((r) => String(r.batch_id))).toEqual(['1', '2']);
  });

  it('KPI and drawer share one backlog module (no duplicated WHERE)', () => {
    const reportingSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/services/ReportingService.ts'),
      'utf8',
    );
    const backlogSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/reporting/plantHeadBacklog.ts'),
      'utf8',
    );
    expect(reportingSrc).toContain('countPlantHeadBacklog');
    expect(reportingSrc).toContain('listPlantHeadBacklog');
    expect(reportingSrc).not.toMatch(/count\(distinct pb\.batch_id\)/);
    expect(backlogSrc).toContain('count(distinct pb.batch_id)');
    expect(backlogSrc).toContain("machine_status', '!=', 'OFFLINE'");
    expect(backlogSrc).toContain('plantHeadActiveMachineFilter');
  });
});
