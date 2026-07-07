import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../src/db';
import { getIntegrationTestUserId } from './helpers/integrationFixtures';

describe('Order Assignment board', () => {
  let dbUp = false;

  beforeAll(async () => {
    try {
      await db.selectFrom('master.shift').select('shift_code').limit(1).execute();
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });

  it.skipIf(!dbUp)('shows unallocated imported batches even when older allocated batches exist elsewhere', async () => {
    const { SixHiService } = await import('../src/services/SixHiService');
    const ts = Date.now();
    const importedBatchNo = `OA-IMPORT-${ts}`;
    const legacyBatchNo = `OA-LEGACY-${ts}`;
    const coilNo = `OA-COIL-${ts}`;
    const planDate = '2026-07-15';
    const shiftCode = 'B';

    await db.insertInto('coil.coil')
      .values({
        coil_no: coilNo,
        grade_code: 'CRCA',
        nominal_width_mm: 1000,
        coil_thk_mm: 2,
        weight_mt: 10,
        status: 'PLANNED',
      })
      .onConflict((oc) => oc.column('coil_no').doNothing())
      .execute();

    const importBatch = await db.insertInto('planning.import_batch')
      .values({
        source: 'XLSX',
        file_name: 'order-assignment-test.xlsx',
        row_count: 1,
        status: 'LOADED',
        imported_by: getIntegrationTestUserId(),
      })
      .returning('import_batch_id')
      .executeTakeFirstOrThrow();

    await db.insertInto('planning.ppc_batch')
      .values({
        batch_number: legacyBatchNo,
        plan_date: new Date('2020-01-01'),
        shift_code: 'A',
        machine_code: '6HI',
        sub_process: 'ROLLING',
        coil_no: coilNo,
        customer_name: 'Legacy Customer',
        grade_code: 'CRCA',
        width_mm: 1000,
        ppc_thk_mm: 0.5,
        ppc_weight_mt: 10,
        machine_allocated: true,
        queue_seq: 1,
      })
      .execute();

    await db.insertInto('planning.ppc_batch')
      .values({
        batch_number: importedBatchNo,
        plan_date: new Date(planDate),
        shift_code: shiftCode,
        machine_code: '6HI',
        sub_process: 'ROLLING',
        coil_no: coilNo,
        customer_name: 'Imported Customer',
        grade_code: 'CRCA',
        width_mm: 1000,
        ppc_thk_mm: 0.5,
        ppc_weight_mt: 12.5,
        machine_allocated: false,
        import_batch_id: Number(importBatch.import_batch_id),
      })
      .execute();

    const board = await SixHiService.getOrderAssignmentBoard();

    expect(board.orders.map((o) => o.batchNumber)).toContain(importedBatchNo);
    expect(board.orders.map((o) => o.batchNumber)).not.toContain(legacyBatchNo);
    const imported = board.orders.find((o) => o.batchNumber === importedBatchNo);
    expect(imported?.planDate).toBe(planDate);
    expect(imported?.shiftCode).toBe(shiftCode);

    await db.deleteFrom('planning.ppc_batch').where('batch_number', 'in', [importedBatchNo, legacyBatchNo]).execute();
    await db.deleteFrom('planning.import_batch').where('import_batch_id', '=', importBatch.import_batch_id).execute();
    await db.deleteFrom('coil.coil').where('coil_no', '=', coilNo).execute();
  });
});
