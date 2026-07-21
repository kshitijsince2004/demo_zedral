import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { db } from '../src/db';
import { getIntegrationTestUserId } from './helpers/integrationFixtures';

describe('PPC rolling import coil provisioning', () => {
  it('commits a new coil before linking order journey', async () => {
    let dbUp = false;
    try {
      await db.selectFrom('master.shift').select('shift_code').limit(1).execute();
      dbUp = true;
    } catch {
      dbUp = false;
    }
    if (!dbUp) return;

    const { PPCImportService } = await import('../src/services/PPCImportService');
    const batchNo = `COILORD-${Date.now()}`;
    const coilNo = `COIL-ORD-${Date.now()}`;

    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        'PV-Desc', 'Batch Number', 'Mother Coil', 'Customer Name', 'Grade',
        'Finish Thickness', 'Pre Stage Thickness', 'Coil Weight', 'Width',
        'Process Route', 'Plan Date', 'Count',
      ],
      ['6HIML', batchNo, coilNo, 'Hero Steels', 'CRCA', '0.50', '2.00', '12.5', '1000', 'SP4RFXCZ', '2026-06-08', '1'],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Rolling Plan');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const userId = getIntegrationTestUserId();
    const preview = await PPCImportService.previewRollingXlsx(buf, 'coil-order.xlsx', userId, 'ROLLING');
    expect(preview.headerError).toBeUndefined();

    const result = await PPCImportService.commitRollingSession(
      preview.sessionId,
      userId,
      [batchNo],
    );
    expect(result.loaded).toBe(1);
    expect(result.status).not.toBe('FAILED');

    const coil = await db.selectFrom('coil.coil')
      .select('coil_no')
      .where('coil_no', '=', coilNo)
      .executeTakeFirst();
    expect(coil?.coil_no).toBe(coilNo);

    const batch = await db.selectFrom('planning.ppc_batch')
      .select(['machine_allocated', 'queue_seq'])
      .where('batch_number', '=', batchNo)
      .executeTakeFirst();
    expect(batch?.machine_allocated).toBe(false);
    expect(batch?.queue_seq).toBeNull();

    const order = await db.selectFrom('txn.crm_order')
      .select('status')
      .where('batch_number', '=', batchNo)
      .executeTakeFirst();
    expect(order?.status).toBe('PENDING');
  });

  it('preview does not block same coil/spec with different batch numbers', async () => {
    let dbUp = false;
    try {
      await db.selectFrom('master.shift').select('shift_code').limit(1).execute();
      dbUp = true;
    } catch {
      dbUp = false;
    }
    if (!dbUp) return;

    const { PPCImportService } = await import('../src/services/PPCImportService');
    const ts = Date.now();
    const coilNo = `COIL-SAME-${ts}`;
    const bn1 = `SAMEPREV-A-${ts}`;
    const bn2 = `SAMEPREV-B-${ts}`;
    const bn3 = `SAMEPREV-C-${ts}`;

    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        'PV-Desc', 'Batch Number', 'Mother Coil', 'Customer Name', 'Grade',
        'Finish Thickness', 'Pre Stage Thickness', 'Coil Weight', 'Width',
        'Process Route', 'Plan Date', 'Count',
      ],
      ['6HIML', bn1, coilNo, 'Hero Steels', 'CRCA', '3.50', '4.00', '1', '1000', 'SPF4FXCLE', '2026-07-19', '1'],
      ['6HIML', bn2, coilNo, 'Hero Steels', 'CRCA', '3.50', '4.00', '1', '1000', 'SPF4FXCLE', '2026-07-19', '1'],
      ['6HIML', bn3, coilNo, 'Hero Steels', 'CRCA', '3.50', '4.00', '1', '1000', 'SPF4FXCLE', '2026-07-19', '1'],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Rolling Plan');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const userId = getIntegrationTestUserId();
    const preview = await PPCImportService.previewRollingXlsx(buf, 'same-coil.xlsx', userId, 'ROLLING');
    expect(preview.headerError).toBeUndefined();

    const target = preview.rows.filter((r) => [bn1, bn2, bn3].includes(r.batchNumber));
    expect(target).toHaveLength(3);
    for (const row of target) {
      expect(row.errors).toEqual([]);
      expect(row.previewStatus).not.toBe('duplicate-in-file');
    }

    const result = await PPCImportService.commitRollingSession(
      preview.sessionId,
      userId,
      [bn1, bn2, bn3],
    );
    expect(result.loaded).toBe(3);
    expect(result.status).not.toBe('FAILED');
  });
});
