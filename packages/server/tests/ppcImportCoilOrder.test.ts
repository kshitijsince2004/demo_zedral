import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { db } from '../src/db';

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

    const preview = await PPCImportService.previewRollingXlsx(buf, 'coil-order.xlsx', 1, 'ROLLING', 'B');
    expect(preview.headerError).toBeUndefined();

    const result = await PPCImportService.commitRollingSession(
      preview.sessionId,
      1,
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
    expect(batch?.machine_allocated).toBe(true);
    expect(Number(batch?.queue_seq)).toBeGreaterThan(0);

    const order = await db.selectFrom('txn.crm6_order')
      .select('status')
      .where('batch_number', '=', batchNo)
      .executeTakeFirst();
    expect(order?.status).toBe('PENDING');
  });
});
