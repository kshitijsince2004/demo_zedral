/**
 * Import fail-safe + journey dedup (A1/A2/A4) — unit + DB-soft regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('classifyJourneyForLine', () => {
  it('returns new when no journey', async () => {
    const conn = {
      selectFrom: vi.fn(() => ({
        select: () => ({
          where: () => ({
            where: () => ({
              executeTakeFirst: async () => undefined,
            }),
          }),
        }),
      })),
    };
    const { classifyJourneyForLine } = await import('../src/services/PPCImportService');
    const result = await classifyJourneyForLine(conn as never, 'COIL-1', 'PKL');
    expect(result).toEqual({ kind: 'new' });
  });

  it('returns already-advanced when target step completed', async () => {
    let call = 0;
    const conn = {
      selectFrom: vi.fn(() => {
        call += 1;
        if (call === 1) {
          return {
            select: () => ({
              where: () => ({
                where: () => ({
                  executeTakeFirst: async () => ({ journey_id: 1, current_step_no: 3 }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            where: () => ({
              orderBy: () => ({
                execute: async () => [
                  { step_no: 1, status: 'COMPLETED', queue_batch_id: 10, process_code: 'HRS', display_label: 'HR Slitting' },
                  { step_no: 2, status: 'COMPLETED', queue_batch_id: 11, process_code: 'PKL', display_label: 'Pickling' },
                  { step_no: 3, status: 'ACTIVE', queue_batch_id: 12, process_code: 'CRM', display_label: 'Rolling' },
                ],
              }),
            }),
          }),
        };
      }),
    };
    const { classifyJourneyForLine } = await import('../src/services/PPCImportService');
    const result = await classifyJourneyForLine(conn as never, 'COIL-1', 'PKL');
    expect(result.kind).toBe('already-advanced');
    if (result.kind === 'already-advanced') {
      expect(result.reason).toMatch(/advanced past PKL/);
    }
  });

  it('returns already-in-line when target has queue batch', async () => {
    let call = 0;
    const conn = {
      selectFrom: vi.fn(() => {
        call += 1;
        if (call === 1) {
          return {
            select: () => ({
              where: () => ({
                where: () => ({
                  executeTakeFirst: async () => ({ journey_id: 1, current_step_no: 2 }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            where: () => ({
              orderBy: () => ({
                execute: async () => [
                  { step_no: 1, status: 'COMPLETED', queue_batch_id: 10, process_code: 'HRS', display_label: 'HR Slitting' },
                  { step_no: 2, status: 'PENDING', queue_batch_id: 99, process_code: 'PKL', display_label: 'Pickling' },
                ],
              }),
            }),
          }),
        };
      }),
    };
    const { classifyJourneyForLine } = await import('../src/services/PPCImportService');
    const result = await classifyJourneyForLine(conn as never, 'COIL-1', 'PKL');
    expect(result.kind).toBe('already-in-line');
  });

  it('returns new for sibling batch when another batch already queues the step', async () => {
    let call = 0;
    const conn = {
      selectFrom: vi.fn((table: string) => {
        call += 1;
        if (call === 1) {
          return {
            select: () => ({
              where: () => ({
                where: () => ({
                  executeTakeFirst: async () => ({ journey_id: 1, current_step_no: 2 }),
                }),
              }),
            }),
          };
        }
        if (table === 'planning.order_journey_step' || call === 2) {
          return {
            select: () => ({
              where: () => ({
                orderBy: () => ({
                  execute: async () => [
                    { step_no: 1, status: 'COMPLETED', queue_batch_id: 10, process_code: 'HRS', display_label: 'HR Slitting' },
                    { step_no: 2, status: 'PENDING', queue_batch_id: 99, process_code: 'PKL', display_label: 'Pickling' },
                  ],
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: async () => ({ batch_number: 'BN-QUEUED' }),
            }),
          }),
        };
      }),
    };
    const { classifyJourneyForLine } = await import('../src/services/PPCImportService');
    const result = await classifyJourneyForLine(conn as never, 'COIL-1', 'PKL', 'BN-SIBLING');
    expect(result).toEqual({ kind: 'new' });
  });

  it('returns new for PENDING target with no queue (fail-safe inject)', async () => {
    let call = 0;
    const conn = {
      selectFrom: vi.fn(() => {
        call += 1;
        if (call === 1) {
          return {
            select: () => ({
              where: () => ({
                where: () => ({
                  executeTakeFirst: async () => ({ journey_id: 1, current_step_no: 2 }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            where: () => ({
              orderBy: () => ({
                execute: async () => [
                  { step_no: 1, status: 'COMPLETED', queue_batch_id: 10, process_code: 'HRS', display_label: 'HR Slitting' },
                  { step_no: 2, status: 'PENDING', queue_batch_id: null, process_code: 'PKL', display_label: 'Pickling' },
                ],
              }),
            }),
          }),
        };
      }),
    };
    const { classifyJourneyForLine } = await import('../src/services/PPCImportService');
    const result = await classifyJourneyForLine(conn as never, 'COIL-1', 'PKL');
    expect(result).toEqual({ kind: 'new' });
  });
});

describe('linkBatchToJourney backward/completed guard', () => {
  const updates: { table: string; set: Record<string, unknown> }[] = [];

  beforeEach(() => {
    updates.length = 0;
    vi.resetModules();
  });

  it('no-ops when target step is behind current_step_no', async () => {
    vi.doMock('../src/db', () => ({ db: {} }));
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');

    const conn = {
      selectFrom: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.where = chain;
        builder.executeTakeFirst = async () => {
          if (table === 'planning.order_journey') {
            return { journey_id: 1, current_step_no: 3 };
          }
          if (table === 'planning.order_journey_step') {
            return { step_id: 10, step_no: 1, status: 'COMPLETED', queue_batch_id: 5, started_at: new Date() };
          }
          return undefined;
        };
        return builder;
      }),
      updateTable: vi.fn((table: string) => {
        const ub: Record<string, unknown> = {};
        ub.set = (set: Record<string, unknown>) => {
          updates.push({ table, set });
          return ub;
        };
        ub.where = () => ub;
        ub.execute = async () => undefined;
        return ub;
      }),
    };

    await ProcessRouteService.linkBatchToJourney(999, 'COIL-1', 'S-P-4', 'HRS', '', conn as never);
    expect(updates).toHaveLength(0);
  });

  it('no-ops when target step is COMPLETED', async () => {
    vi.doMock('../src/db', () => ({ db: {} }));
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');

    const conn = {
      selectFrom: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.where = chain;
        builder.executeTakeFirst = async () => {
          if (table === 'planning.order_journey') {
            return { journey_id: 1, current_step_no: 1 };
          }
          if (table === 'planning.order_journey_step') {
            // Same step_no as current but COMPLETED (edge) — still no-op
            return { step_id: 10, step_no: 1, status: 'COMPLETED', queue_batch_id: 5, started_at: new Date() };
          }
          return undefined;
        };
        return builder;
      }),
      updateTable: vi.fn((table: string) => {
        const ub: Record<string, unknown> = {};
        ub.set = (set: Record<string, unknown>) => {
          updates.push({ table, set });
          return ub;
        };
        ub.where = () => ub;
        ub.execute = async () => undefined;
        return ub;
      }),
    };

    await ProcessRouteService.linkBatchToJourney(999, 'COIL-1', 'S-P-4', 'HRS', '', conn as never);
    expect(updates).toHaveLength(0);
  });

  it('activates PENDING step with no queue batch', async () => {
    vi.doMock('../src/db', () => ({ db: {} }));
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');

    const conn = {
      selectFrom: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.where = chain;
        builder.executeTakeFirst = async () => {
          if (table === 'planning.order_journey') {
            return { journey_id: 1, current_step_no: 2 };
          }
          if (table === 'planning.order_journey_step') {
            return { step_id: 20, step_no: 2, status: 'PENDING', queue_batch_id: null, started_at: null };
          }
          return undefined;
        };
        return builder;
      }),
      updateTable: vi.fn((table: string) => {
        const ub: Record<string, unknown> = {};
        ub.set = (set: Record<string, unknown>) => {
          updates.push({ table, set });
          return ub;
        };
        ub.where = () => ub;
        ub.execute = async () => undefined;
        return ub;
      }),
    };

    await ProcessRouteService.linkBatchToJourney(777, 'COIL-1', 'S-P-4', 'PKL', '', conn as never);
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.some((u) => u.table === 'planning.order_journey_step' && u.set.status === 'ACTIVE')).toBe(true);
    expect(updates.some((u) => u.table === 'planning.order_journey' && u.set.current_step_no === 2)).toBe(true);
  });

  it('swaps synthetic queue_batch_id to incoming real batch', async () => {
    vi.doMock('../src/db', () => ({ db: {} }));
    const { ProcessRouteService, resolveLinkRouteCode } = await import('../src/services/ProcessRouteService');

    const updatesLocal: { table: string; set: Record<string, unknown> }[] = [];

    const coilNo = 'COIL-1';
    const batchIdReal = 222;
    const batchIdSynthetic = 111;
    const routeRaw = 'S-P-4';
    const machineCode = 'HRS';
    const subProcess = '';
    const code = resolveLinkRouteCode(machineCode, subProcess, routeRaw);
    if (!code) throw new Error('test setup: expected resolveLinkRouteCode to return a code');

    const syntheticBatchNumber = `${coilNo}-${code}-T1F2`;
    const incomingBatchNumber = `REAL-${batchIdReal}`;

    const conn = {
      selectFrom: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder as any;
        // For fluent builders, we ignore where/select/orderBy args and just return `builder`.
        (builder as any).select = chain;
        (builder as any).where = chain;
        (builder as any).orderBy = chain;

        (builder as any).executeTakeFirst = async () => {
          if (table === 'planning.order_journey') {
            return { journey_id: 1, current_step_no: 1 };
          }
          if (table === 'planning.order_journey_step') {
            return { step_id: 10, step_no: 1, status: 'ACTIVE', queue_batch_id: batchIdSynthetic, started_at: new Date() };
          }
          return undefined;
        };

        (builder as any).execute = async () => {
          if (table === 'planning.ppc_batch') {
            return [
              { batch_id: String(batchIdSynthetic), batch_number: syntheticBatchNumber },
              { batch_id: String(batchIdReal), batch_number: incomingBatchNumber },
            ];
          }
          return [];
        };

        return builder as any;
      }),
      updateTable: vi.fn((table: string) => {
        const ub: any = {};
        ub.set = (set: Record<string, unknown>) => {
          updatesLocal.push({ table, set });
          return ub;
        };
        ub.where = () => ub;
        ub.execute = async () => undefined;
        return ub;
      }),
    };

    await ProcessRouteService.linkBatchToJourney(batchIdReal, coilNo, routeRaw, machineCode, subProcess, conn as never);

    const swap = updatesLocal.find((u) => u.table === 'planning.order_journey_step' && u.set.queue_batch_id === batchIdReal);
    expect(swap).toBeTruthy();
  });
});

describe('linkBatchToJourney slit_id normalize', () => {
  const updates: { table: string; set: Record<string, unknown> }[] = [];

  beforeEach(() => {
    updates.length = 0;
    vi.resetModules();
  });

  function connWith(opts: { slitId?: string | null }) {
    return {
      selectFrom: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.where = chain;
        builder.executeTakeFirst = async () => {
          if (table === 'planning.ppc_batch') {
            return { slit_id: opts.slitId ?? null };
          }
          if (table === 'planning.order_journey') {
            return { journey_id: 1, current_step_no: 3 };
          }
          if (table === 'planning.order_journey_step') {
            return { step_id: 10, step_no: 1, status: 'COMPLETED', queue_batch_id: 5, started_at: new Date() };
          }
          return undefined;
        };
        return builder;
      }),
      updateTable: vi.fn((table: string) => {
        const ub: Record<string, unknown> = {};
        ub.set = (set: Record<string, unknown>) => {
          updates.push({ table, set });
          return ub;
        };
        ub.where = () => ub;
        ub.execute = async () => undefined;
        return ub;
      }),
    };
  }

  it('normalizes a divergent child batch slit_id to the coil suffix', async () => {
    vi.doMock('../src/db', () => ({ db: {} }));
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');
    await ProcessRouteService.linkBatchToJourney(
      1543, '110038829-C', 'S-P-4', 'HRS', '', connWith({ slitId: 'B' }) as never,
    );
    expect(updates).toEqual([{ table: 'planning.ppc_batch', set: { slit_id: 'C' } }]);
  });

  it('leaves a matching child batch untouched', async () => {
    vi.doMock('../src/db', () => ({ db: {} }));
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');
    await ProcessRouteService.linkBatchToJourney(
      1543, '110038829-C', 'S-P-4', 'HRS', '', connWith({ slitId: 'C' }) as never,
    );
    expect(updates).toHaveLength(0);
  });

  it('leaves a mother batch (no suffix) untouched', async () => {
    vi.doMock('../src/db', () => ({ db: {} }));
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');
    await ProcessRouteService.linkBatchToJourney(
      1543, '110038829', 'S-P-4', 'HRS', '', connWith({ slitId: 'A' }) as never,
    );
    expect(updates).toHaveLength(0);
  });
});

describe('reconcileAllocationSafeFieldsForJourneyStep (unit)', () => {
  it('updates only ALLOCATION_SAFE_FIELDS on the linked batch', async () => {
    const { PPCImportService } = await import('../src/services/PPCImportService');

    const coilNo = 'COIL-1';
    const processCode = 'PKL';

    let updatedSet: Record<string, unknown> | null = null;

    const trx = {
      selectFrom: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder as any;
        (builder as any).select = chain;
        (builder as any).where = chain;
        (builder as any).orderBy = chain;

        (builder as any).executeTakeFirst = async () => {
          if (table === 'planning.order_journey') {
            return { journey_id: 1 };
          }
          if (table === 'planning.order_journey_step') {
            return { queue_batch_id: 55, step_no: 2, status: 'COMPLETED' };
          }
          return undefined;
        };

        return builder as any;
      }),
      updateTable: vi.fn((table: string) => {
        expect(table).toBe('planning.ppc_batch');
        const ub: any = {};
        ub.set = (set: Record<string, unknown>) => {
          updatedSet = set;
          return ub;
        };
        ub.where = () => ub;
        ub.execute = async () => undefined;
        return ub;
      }),
    };

    const incomingBatchValues = {
      customer_name: 'NEW_CUSTOMER',
      grade_code: 'CRCA',
      width_mm: 1234,
      input_thk_mm: 2.1,
      ppc_thk_mm: 2.2,
      machine_code: 'HRS', // should be ignored
      machine_allocated: true, // should be ignored
      raw_row_json: '{raw}', // allowed
    };

    const result = await (PPCImportService as any).reconcileAllocationSafeFieldsForJourneyStep(
      trx as any,
      coilNo,
      processCode,
      incomingBatchValues,
    );

    expect(result.ok).toBe(true);
    expect(updatedSet).not.toBeNull();
    expect(updatedSet).toMatchObject({
      customer_name: 'NEW_CUSTOMER',
      grade_code: 'CRCA',
      width_mm: 1234,
      input_thk_mm: 2.1,
      ppc_thk_mm: 2.2,
      raw_row_json: '{raw}',
    });
    expect(updatedSet).not.toHaveProperty('machine_code');
    expect(updatedSet).not.toHaveProperty('machine_allocated');
  });
});

describe('re-import advanced coil regression (DB)', () => {
  it('PKL-scoped re-import of advanced coil is advanced-skipped and leaves journey pointer', async () => {
    const { db } = await import('../src/db');
    let dbUp = false;
    try {
      await db.selectFrom('master.shift').select('shift_code').limit(1).execute();
      dbUp = true;
    } catch {
      dbUp = false;
    }
    if (!dbUp) return;

    const { PPCImportService } = await import('../src/services/PPCImportService');
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');
    const XLSX = await import('xlsx');
    const { getIntegrationTestUserId } = await import('./helpers/integrationFixtures');

    const ts = Date.now();
    const coilNo = `ADV-COIL-${ts}`;
    const batchNo = `ADV-BN-${ts}`;
    const userId = getIntegrationTestUserId();

    // Seed coil + journey at PKL (step 2) after HRS completed.
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

    // Ensure grade exists for FK if needed
    await db.insertInto('master.grade')
      .values({ grade_code: 'CRCA', description: 'test', grade_family: 'PPC' })
      .onConflict((oc) => oc.column('grade_code').doNothing())
      .execute();

    const journeyId = await ProcessRouteService.createJourney(coilNo, 'S-P-4-F');
    await db.updateTable('planning.order_journey_step')
      .set({ status: 'COMPLETED', completed_at: new Date(), queue_batch_id: null })
      .where('journey_id', '=', String(journeyId))
      .where('step_no', '=', 1)
      .execute();
    await db.updateTable('planning.order_journey_step')
      .set({ status: 'PENDING', queue_batch_id: null })
      .where('journey_id', '=', String(journeyId))
      .where('step_no', '=', 2)
      .execute();
    // Simulate advanced past PKL: mark PKL completed, pointer at CRM
    await db.updateTable('planning.order_journey_step')
      .set({ status: 'COMPLETED', completed_at: new Date() })
      .where('journey_id', '=', String(journeyId))
      .where('step_no', '=', 2)
      .execute();
    await db.updateTable('planning.order_journey')
      .set({ current_step_no: 3, updated_at: new Date() })
      .where('journey_id', '=', String(journeyId))
      .execute();

    const before = await db.selectFrom('planning.order_journey')
      .select('current_step_no')
      .where('journey_id', '=', String(journeyId))
      .executeTakeFirstOrThrow();

    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        'PV-Desc', 'Batch Number', 'Mother Coil', 'Customer Name', 'Grade',
        'Pre Stage Thickness', 'Coil Weight', 'Width',
        'Process Route', 'Plan Date', 'Count', 'First ANL TMP',
      ],
      ['PICKL', batchNo, coilNo, 'Hero Steels', 'CRCA', '2.00', '12.5', '1000', 'SP4F', '2026-06-08', '1', '680'],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const preview = await PPCImportService.previewRollingXlsx(buf, 'adv.xlsx', userId, 'PKL', 'PKL');
    const row = preview.rows.find((r) => r.batchNumber === batchNo);
    expect(row?.previewStatus).toBe('advanced-skipped');

    const batchCountBefore = await db.selectFrom('planning.ppc_batch')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('coil_no', '=', coilNo)
      .executeTakeFirst();

    // Commit should skip — select the advanced row (won't be importable in UI, but force commit path)
    // Session only has filtered rows; commit with that batch still hits upsert safety.
    if (preview.sessionId) {
      const result = await PPCImportService.commitRollingSession(preview.sessionId, userId, [batchNo]);
      expect(result.loaded).toBe(0);
      expect((result.skippedAdvanced ?? 0) + (result.skipped ?? 0)).toBeGreaterThan(0);
    }

    const after = await db.selectFrom('planning.order_journey')
      .select('current_step_no')
      .where('journey_id', '=', String(journeyId))
      .executeTakeFirstOrThrow();
    expect(after.current_step_no).toBe(before.current_step_no);

    const batchCountAfter = await db.selectFrom('planning.ppc_batch')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('coil_no', '=', coilNo)
      .executeTakeFirst();
    expect(Number(batchCountAfter?.c ?? 0)).toBe(Number(batchCountBefore?.c ?? 0));
  });
});

describe('checkCoilSafetyForLine (F1 inject-path)', () => {
  it('flags live PKL order with no journey', async () => {
    const { PPCImportService } = await import('../src/services/PPCImportService');
    const conn = {
      selectFrom: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.leftJoin = chain;
        builder.innerJoin = chain;
        builder.select = chain;
        builder.where = chain;
        builder.orderBy = chain;
        builder.execute = async () => [];
        builder.executeTakeFirst = async () => {
          if (table === 'coil.coil as c') {
            return {
              hrs_status: null,
              pkl_status: 'IN_PROGRESS',
              ann_status: null,
              prod_hrs_id: null,
              prod_pkl_id: null,
              prod_rwd_id: null,
              prod_rwd_weight: null,
            };
          }
          if (table === 'planning.order_journey') return undefined;
          return undefined;
        };
        return builder;
      }),
    };
    const result = await PPCImportService.checkCoilSafetyForLine(conn as never, 'COIL-LIVE', 'PKL');
    expect(result.isDangerous).toBe(true);
    expect(result.skipReason).toMatch(/IN_PROGRESS on PKL/);
  });

  it('flags ANN charge when journey has no ANN step', async () => {
    const { PPCImportService } = await import('../src/services/PPCImportService');
    let journeyCalls = 0;
    const conn = {
      selectFrom: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.leftJoin = chain;
        builder.innerJoin = chain;
        builder.select = chain;
        builder.where = chain;
        builder.orderBy = chain;
        builder.execute = async () => {
          // Journey steps: HRS only — no ANN
          return [
            { step_no: 1, status: 'ACTIVE', queue_batch_id: 1, process_code: 'HRS', display_label: 'HR Slitting' },
          ];
        };
        builder.executeTakeFirst = async () => {
          if (table === 'coil.coil as c') {
            return {
              hrs_status: null,
              pkl_status: null,
              ann_status: 'IN_PROGRESS',
              prod_hrs_id: null,
              prod_pkl_id: null,
              prod_rwd_id: null,
              prod_rwd_weight: null,
            };
          }
          if (table === 'planning.order_journey') {
            journeyCalls += 1;
            return { journey_id: 9, current_step_no: 1 };
          }
          return undefined;
        };
        return builder;
      }),
    };
    const result = await PPCImportService.checkCoilSafetyForLine(conn as never, 'COIL-ANN', 'ANN');
    expect(result.isDangerous).toBe(true);
    expect(result.skipReason).toMatch(/IN_PROGRESS on ANN/);
    expect(journeyCalls).toBeGreaterThan(0);
  });

  it('allows genuinely new coil with no order', async () => {
    const { PPCImportService } = await import('../src/services/PPCImportService');
    const conn = {
      selectFrom: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.leftJoin = chain;
        builder.innerJoin = chain;
        builder.select = chain;
        builder.where = chain;
        builder.orderBy = chain;
        builder.execute = async () => [];
        builder.executeTakeFirst = async () => {
          if (table === 'coil.coil as c') {
            return {
              hrs_status: null,
              pkl_status: null,
              ann_status: null,
              prod_hrs_id: null,
              prod_pkl_id: null,
              prod_rwd_id: null,
              prod_rwd_weight: null,
            };
          }
          return undefined;
        };
        return builder;
      }),
    };
    const result = await PPCImportService.checkCoilSafetyForLine(conn as never, 'COIL-NEW', 'PKL');
    expect(result.isDangerous).toBe(false);
    expect(result.skipReason).toBeNull();
  });
});

describe('inject-path safety DB (F1)', () => {
  it('skips new batch_number when coil has live pkl_order and no journey', async () => {
    const { db } = await import('../src/db');
    let dbUp = false;
    try {
      await db.selectFrom('master.shift').select('shift_code').limit(1).execute();
      dbUp = true;
    } catch {
      dbUp = false;
    }
    if (!dbUp) return;

    const { PPCImportService } = await import('../src/services/PPCImportService');
    const XLSX = await import('xlsx');
    const { getIntegrationTestUserId } = await import('./helpers/integrationFixtures');

    const ts = Date.now();
    const coilNo = `INJ-PKL-${ts}`;
    const batchNo = `INJ-BN-${ts}`;
    const userId = getIntegrationTestUserId();

    await db.insertInto('master.grade')
      .values({ grade_code: 'CRCA', description: 'test', grade_family: 'PPC' })
      .onConflict((oc) => oc.column('grade_code').doNothing())
      .execute();

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

    await db.insertInto('txn.pkl_order')
      .values({
        coil_no: coilNo,
        customer_name: 'Hero Steels',
        grade_code: 'CRCA',
        nominal_width_mm: 1000,
        nominal_thk_mm: 2,
        mother_coil_weight_mt: 10,
        machine_code: 'PKL',
        status: 'IN_PROGRESS',
      })
      .onConflict((oc) => oc.column('coil_no').doNothing())
      .execute();

    // Ensure no ACTIVE journey
    await db.updateTable('planning.order_journey')
      .set({ status: 'COMPLETED', updated_at: new Date() })
      .where('coil_no', '=', coilNo)
      .where('status', '=', 'ACTIVE')
      .execute();

    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [
        'PV-Desc', 'Batch Number', 'Mother Coil', 'Customer Name', 'Grade',
        'Pre Stage Thickness', 'Coil Weight', 'Width',
        'Process Route', 'Plan Date', 'Count', 'First ANL TMP',
      ],
      ['PICKL', batchNo, coilNo, 'Hero Steels', 'CRCA', '2.00', '12.5', '1000', 'SP4F', '2026-06-08', '1', '680'],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const preview = await PPCImportService.previewRollingXlsx(buf, 'inj.xlsx', userId, 'PKL', 'PKL');
    const row = preview.rows.find((r) => r.batchNumber === batchNo);
    expect(row?.previewStatus).toBe('in-production');
    expect(row?.skipReason).toMatch(/IN_PROGRESS on PKL/);

    const before = await db.selectFrom('planning.ppc_batch')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('batch_number', '=', batchNo)
      .executeTakeFirst();

    const result = await PPCImportService.commitRollingSession(preview.sessionId, userId, [batchNo]);
    expect(result.loaded).toBe(0);

    const after = await db.selectFrom('planning.ppc_batch')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('batch_number', '=', batchNo)
      .executeTakeFirst();
    expect(Number(after?.c ?? 0)).toBe(Number(before?.c ?? 0));
  });
});
