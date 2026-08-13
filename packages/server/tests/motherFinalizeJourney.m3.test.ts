import { describe, it, expect } from 'vitest';
import { db } from '../src/db';

describe('M3 — mother finalizeJourney after HRS slitting', () => {
  it('marks mother order_journey COMPLETED and keeps it out of PKL queue', async () => {
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

    const { ShiftDetectionService } = await import('../src/services/ShiftDetectionService');
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');
    const { QueueTransferService } = await import('../src/services/QueueTransferService');
    const { registerJourneyAdvanceConsumer } = await import('../src/modules/m1-collection/consumers/JourneyAdvanceConsumer');
    const { emitProductionCaptured } = await import('../src/services/journeyHandoff');

    // Keep coil_no short: QueueTransferService composes planning.ppc_batch.batch_number
    // as `${coil_no}-${route_code}-${ts}`, and batch_number is varchar(30).
    const coilNo = `M3-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const gradeCode = 'CRCA';

    // Seed mother coil + master data (integration fixtures normally already seed customer/grade).
    await db.insertInto('coil.coil')
      .values({
        coil_no: coilNo,
        grade_code: gradeCode,
        nominal_width_mm: 1000,
        coil_width_mm: 1000,
        coil_thk_mm: 2,
        weight_mt: 10,
        status: 'PLANNED',
      })
      .onConflict((oc) => oc.column('coil_no').doNothing())
      .execute();

    const resolved = await ShiftDetectionService.resolveShift({ userId, machineCode: 'HRS' });

    // Create journey with HRS as the first active step, then enqueue the ACTIVE HRS queue batch
    // so spawnChildCoils can find motherBatch.shift_code/customer/grade.
    const journeyId = await ProcessRouteService.createJourney(coilNo, 'S-P');

    const sourceBatch: any = {
      batch_id: 0,
      batch_number: '',
      coil_no: coilNo,
      plan_date: new Date(),
      shift_code: resolved.shiftCode,
      customer_name: 'Tata Motors',
      grade_code: gradeCode,
      width_mm: 1000,
      ppc_thk_mm: 2,
      ppc_weight_mt: 10,
      destination: null,
      roll_finish: null,
      slit_id: null,
      sap_order_no: null,
    };

    const motherBatchId = await QueueTransferService.enqueueActiveStep(journeyId, sourceBatch, {}, db);
    expect(motherBatchId).not.toBeNull();

    const prodEntry = await db.insertInto('txn.prod_hrs')
      .values({
        coil_no: coilNo,
        shift_log_id: Number(resolved.shiftLogId),
        status: 'COMPLETED',
        scrap_mt: null,
        weight_mt: 10,
        mother_coil_weight_mt: 10,
        nominal_width_mm: 1000,
        nominal_thk_mm: 2,
      } as any)
      .returning('entry_id')
      .executeTakeFirstOrThrow();
    const entryId = String(prodEntry.entry_id);

    // One active slit → spawn child coils and enqueue them for the next line.
    await db.insertInto('txn.prod_hrs_slit')
      .values({
        entry_id: Number(entryId),
        slot: 'A',
        width_mm: 120,
        thk_mm: 2,
        child_coil_no: null,
        hold_flag: false,
        for_ctl_flag: false,
        route_raw: null,
        planned_thk_mm: 2,
        planned_weight_mt: 3,
        actual_weight_mt: 3,
      } as any)
      .execute();

    const unsubscribe = registerJourneyAdvanceConsumer();
    try {
      await emitProductionCaptured('HRS', String(resolved.shiftLogId), entryId, coilNo);

      // Poll briefly: the consumer runs async off the event bus.
      let status: string | null = null;
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 150));
        const mother = await db.selectFrom('planning.order_journey')
          .select('status')
          .where('coil_no', '=', coilNo)
          .executeTakeFirst();
        status = mother?.status ?? null;
        if (status === 'COMPLETED') break;
      }

      expect(status).toBe('COMPLETED');

      const activePklRows = await db
        .selectFrom('planning.order_journey_step as ojs')
        .innerJoin('planning.order_journey as oj', (join) =>
          join.onRef('ojs.journey_id', '=', 'oj.journey_id'),
        )
        .select('ojs.step_id')
        .where('oj.coil_no', '=', coilNo)
        .where('oj.status', 'in', ['ACTIVE', 'HOLD'])
        .where('ojs.process_code', '=', 'PKL')
        .where('ojs.status', 'in', ['PENDING', 'ACTIVE', 'HOLD'])
        .execute();

      expect(activePklRows).toHaveLength(0);
    } finally {
      unsubscribe?.();
    }
  });
});

