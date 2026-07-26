import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../src/db';
import { ReportingService } from '../src/services/ReportingService';
import { currentPlantDate, addPlantDays } from '@m1/shared-validation';
import { LegacyOrderSource } from '../src/services/handover/LegacyOrderSource';

const dbUp = process.env.VITEST_DB_AVAILABLE === '1' || process.env.GITHUB_ACTIONS === 'true';

describe.skipIf(!dbUp)('Plant Head backlog consistency', () => {
  beforeAll(async () => {
    await db.selectFrom('master.shift').select('shift_code').limit(1).execute();
  });

  it('backlogCount equals drawer total; OFFLINE batches excluded from both', async () => {
    const ts = String(Date.now()).slice(-6);
    const offlineBatch = `BL-OFF-${ts}`;
    const activeBatch = `BL-ON-${ts}`;
    const coilNo = `BLC${ts}`;
    const planDate = addPlantDays(currentPlantDate(), -3);

    // CI seeds may have zero OFFLINE machines; pick any two and force statuses below.
    const machines = await db
      .selectFrom('master.machine')
      .select(['machine_code', 'machine_status'])
      .orderBy('machine_code')
      .limit(2)
      .execute();

    expect(machines.length).toBeGreaterThanOrEqual(2);

    const offlineMachine = machines[0]!;
    const activeMachine = machines[1]!;
    const offlineCode = offlineMachine.machine_code;
    const activeCode = activeMachine.machine_code;
    const prevOfflineStatus = offlineMachine.machine_status;
    const prevActiveStatus = activeMachine.machine_status;

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

    const batchValues = (batchNumber: string, machineCode: string) => ({
      batch_number: batchNumber,
      plan_date: new Date(planDate),
      shift_code: 'A',
      machine_code: machineCode,
      sub_process: 'ROLLING',
      coil_no: coilNo,
      customer_name: 'Backlog Test Customer',
      grade_code: 'CRCA',
      width_mm: 1000,
      ppc_thk_mm: 0.5,
      input_thk_mm: 0.5,
      ppc_weight_mt: 10,
      machine_allocated: true,
      queue_seq: 1,
    });

    try {
      // Force statuses used by the assertions (restore in finally).
      await db.updateTable('master.machine').set({ machine_status: 'OFFLINE' }).where('machine_code', '=', offlineCode).execute();
      await db.updateTable('master.machine').set({ machine_status: 'OPERATIONAL' }).where('machine_code', '=', activeCode).execute();

      await db.insertInto('planning.ppc_batch').values(batchValues(offlineBatch, offlineCode) as any).execute();
      await db.insertInto('planning.ppc_batch').values(batchValues(activeBatch, activeCode) as any).execute();

      const dash = await ReportingService.getPlantHeadDashboard(7);
      const list = await ReportingService.getPlantHeadBacklog();

      expect(dash.backlogCount).toBe(list.total);
      expect(list.totalUnfiltered).toBe(list.total);
      expect(list.orders.some((o) => o.batchNumber === offlineBatch)).toBe(false);
      expect(list.orders.some((o) => o.batchNumber === activeBatch)).toBe(true);
      expect(list.availableMachines.some((m) => m.machineCode === activeCode)).toBe(true);
      expect(list.availableMachines.some((m) => m.machineCode === offlineCode)).toBe(false);

      const filtered = await ReportingService.getPlantHeadBacklog({ machineCode: activeCode });
      expect(filtered.orders.every((o) => o.machineCode === activeCode)).toBe(true);
      expect(filtered.totalUnfiltered).toBe(list.total);
      expect(filtered.availableMachines.some((m) => m.machineCode === activeCode)).toBe(true);

      const searched = await ReportingService.getPlantHeadBacklog({ search: activeBatch });
      expect(searched.orders.some((o) => o.batchNumber === activeBatch)).toBe(true);
    } finally {
      await db.deleteFrom('planning.ppc_batch').where('batch_number', 'in', [offlineBatch, activeBatch]).execute();
      await db.updateTable('master.machine').set({ machine_status: prevOfflineStatus }).where('machine_code', '=', offlineCode).execute();
      await db.updateTable('master.machine').set({ machine_status: prevActiveStatus }).where('machine_code', '=', activeCode).execute();
      await db.deleteFrom('coil.coil').where('coil_no', '=', coilNo).execute().catch(() => {});
    }
  });

  it('LegacyOrderSource returns ppc_batch backlog for non-CRM machine', async () => {
    const ts = String(Date.now()).slice(-6);
    const batchNumber = `LEG-BL-${ts}`;
    const coilNo = `LGC${ts}`;
    const planDate = addPlantDays(currentPlantDate(), -2);

    const machine = await db
      .selectFrom('master.machine')
      .select(['machine_code', 'machine_status'])
      .where('machine_code', '=', 'HRS')
      .executeTakeFirstOrThrow();

    const machineCode = machine.machine_code;
    const prevStatus = machine.machine_status;

    await db.insertInto('coil.coil')
      .values({
        coil_no: coilNo,
        grade_code: 'CRCA',
        nominal_width_mm: 1000,
        coil_thk_mm: 2,
        weight_mt: 8,
        status: 'PLANNED',
      })
      .onConflict((oc) => oc.column('coil_no').doNothing())
      .execute();

    try {
      await db.updateTable('master.machine')
        .set({ machine_status: 'OPERATIONAL' })
        .where('machine_code', '=', machineCode)
        .execute();

      await db.insertInto('planning.ppc_batch').values({
        batch_number: batchNumber,
        plan_date: new Date(planDate),
        shift_code: 'A',
        machine_code: machineCode,
        sub_process: 'ROLLING',
        coil_no: coilNo,
        customer_name: 'Legacy Cust',
        grade_code: 'CRCA',
        width_mm: 1000,
        ppc_thk_mm: 0.5,
        input_thk_mm: 0.5,
        ppc_weight_mt: 8,
        machine_allocated: false,
        queue_seq: 1,
      } as any).execute();

      const src = new LegacyOrderSource();
      const snap = await src.getQueueSnapshot(currentPlantDate(), 'A', machineCode);
      expect(snap.backlogRolling.some((c: any) => c.batchNumber === batchNumber)).toBe(true);
      expect(snap.backlogSkinpass).toEqual([]);
    } finally {
      await db.deleteFrom('planning.ppc_batch').where('batch_number', '=', batchNumber).execute();
      await db.updateTable('master.machine').set({ machine_status: prevStatus }).where('machine_code', '=', machineCode).execute();
      await db.deleteFrom('coil.coil').where('coil_no', '=', coilNo).execute().catch(() => {});
    }
  });
});
