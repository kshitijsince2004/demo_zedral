import { describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { derivedChildCoilNo } from '../src/utils/childCoil';

describe('HRS slit-scoped hold (db)', () => {
  it('holds one of three slits without rejecting the mother', async () => {
    let dbUp = false;
    try {
      await db.selectFrom('master.shift').select('shift_code').limit(1).execute();
      dbUp = true;
    } catch {
      dbUp = false;
    }
    if (!dbUp) return;

    const { ensureIntegrationTestFixtures, getIntegrationTestUserId } = await import('./helpers/integrationFixtures');
    await ensureIntegrationTestFixtures();
    const userId = getIntegrationTestUserId();
    const { HrsOrderService } = await import('../src/services/HrsOrderService');
    const { PklOrderService } = await import('../src/services/PklOrderService');
    const { ShiftDetectionService } = await import('../src/services/ShiftDetectionService');

    const stamp = Date.now().toString(36).slice(-6).toUpperCase();
    const coilNo = `HS${stamp}`;
    await db.insertInto('coil.coil')
      .values({
        coil_no: coilNo,
        grade_code: 'CRCA',
        nominal_width_mm: 1000,
        coil_width_mm: 1000,
        coil_thk_mm: 2,
        weight_mt: 18,
        status: 'PLANNED',
      })
      .onConflict((oc) => oc.column('coil_no').doNothing())
      .execute();

    const planDate = new Date();
    for (const slit of ['A', 'B', 'C'] as const) {
      await db.insertInto('planning.ppc_batch').values({
        batch_number: `${coilNo}-${slit}`.slice(0, 30),
        coil_no: coilNo,
        customer_name: 'Acme',
        grade_code: 'CRCA',
        width_mm: 300,
        input_thk_mm: 2,
        ppc_thk_mm: 2,
        ppc_weight_mt: 6,
        machine_code: 'HRS',
        sub_process: 'HRS',
        from_work_center: 'S',
        slit_id: slit,
        shift_code: 'B',
        plan_date: planDate,
      } as any).execute();
    }

    await HrsOrderService.ensureOrder(coilNo, userId);
    await db.updateTable('txn.hrs_order')
      .set({ status: 'IN_PROGRESS', updated_at: new Date() })
      .where('coil_no', '=', coilNo)
      .execute();

    await HrsOrderService.rejectSlit(coilNo, 'A', 'HOLD', 'one of three', userId, `${coilNo}-A`.slice(0, 30));

    const mother = await db.selectFrom('txn.hrs_order').select(['status']).where('coil_no', '=', coilNo).executeTakeFirstOrThrow();
    expect(mother.status).not.toBe('REJECTED');
    expect(['PENDING', 'PREPARING', 'IN_PROGRESS', 'STOPPAGE']).toContain(mother.status);

    const childA = derivedChildCoilNo(coilNo, 'A');
    const child = await db.selectFrom('coil.coil').select('status').where('coil_no', '=', childA).executeTakeFirst();
    expect(child?.status).toBe('HOLD');

    const held = await db.selectFrom('txn.prod_hrs_slit as s')
      .innerJoin('txn.prod_hrs as h', 'h.entry_id', 's.entry_id')
      .select(['s.slot', 's.hold_flag'])
      .where('h.coil_no', '=', coilNo)
      .execute();
    const bySlot = Object.fromEntries(held.map((s) => [String(s.slot).toUpperCase(), !!s.hold_flag]));
    expect(bySlot.A).toBe(true);
    expect(bySlot.B ?? false).toBe(false);
    expect(bySlot.C ?? false).toBe(false);

    const queue = await HrsOrderService.getQueue(userId);
    const mine = queue.queue.filter((c) => c.coilNo === coilNo);
    expect(mine.some((c) => c.status === 'IN_PROGRESS' || c.status === 'PREPARING' || c.status === 'PENDING')).toBe(true);
    expect(mine.some((c) => c.slitId === 'A' && (c.status === 'REJECTED' || c.status === 'HOLD'))).toBe(true);

    // PKL: two batches same coil — reject batch 1 does not REJECTED batch 2.
    const pkl1 = `P1${stamp}`.slice(0, 30);
    const pkl2 = `P2${stamp}`.slice(0, 30);
    const shift = await ShiftDetectionService.getCurrentShift({ userId, machineCode: 'PKL' });
    for (const batchNumber of [pkl1, pkl2]) {
      await db.insertInto('planning.ppc_batch').values({
        batch_number: batchNumber,
        coil_no: coilNo,
        customer_name: 'Acme',
        grade_code: 'CRCA',
        width_mm: 300,
        input_thk_mm: 2,
        ppc_thk_mm: 2,
        ppc_weight_mt: 6,
        machine_code: 'PKL',
        sub_process: 'PKL',
        from_work_center: 'P',
        shift_code: shift.shiftCode,
        plan_date: planDate,
      } as any).execute();
      await PklOrderService.ensureOrderForBatch(batchNumber, userId, coilNo);
    }
    await PklOrderService.rejectOrder(coilNo, 'HOLD', 'batch 1 only', userId, pkl1);
    const pklRows = await db.selectFrom('txn.pkl_order')
      .select(['batch_number', 'status'])
      .where('coil_no', '=', coilNo)
      .where('batch_number', 'in', [pkl1, pkl2])
      .execute();
    expect(pklRows.find((r) => r.batch_number === pkl1)?.status).toBe('REJECTED');
    expect(pklRows.find((r) => r.batch_number === pkl2)?.status).not.toBe('REJECTED');
  });
});
