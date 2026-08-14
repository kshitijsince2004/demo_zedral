import { beforeEach, describe, expect, it, vi } from 'vitest';

const publish = vi.fn().mockResolvedValue(undefined);
const advanceJourneyByCoil = vi.fn().mockResolvedValue(null);
const enqueueActiveStep = vi.fn().mockResolvedValue(42);

let prodRow: { entry_id: string; shift_log_id: string } | null = null;
let inv1Rows: unknown[] = [];
let strandedRows: unknown[] = [];
let coilRow: Record<string, unknown> | null = null;
let lastSql = '';

const selectBuilder: any = {
  select: () => selectBuilder,
  selectAll: () => selectBuilder,
  where: () => selectBuilder,
  orderBy: () => selectBuilder,
  executeTakeFirst: async () => {
    if (coilRow) return coilRow;
    return prodRow;
  },
};

vi.mock('../src/db', () => ({
  db: {
    selectFrom: (table: string) => {
      if (table === 'coil.coil') {
        return {
          selectAll: () => ({
            where: () => ({
              executeTakeFirst: async () => coilRow,
            }),
          }),
        };
      }
      return selectBuilder;
    },
  },
}));

vi.mock('kysely', () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray) => ({
      execute: async () => {
        const q = strings.join('');
        lastSql = q;
        if (q.includes('machine_code IS NOT NULL')) return { rows: inv1Rows };
        if (q.includes('nxt.queue_batch_id IS NULL')) return { rows: strandedRows };
        return { rows: [] };
      },
    }),
    {},
  ),
}));

vi.mock('@zedral/platform', () => ({
  buildEventEnvelope: (args: unknown) => args,
  getEventBus: () => ({ publish }),
}));

vi.mock('../src/context', () => ({
  getTenantId: () => 'tenant-1',
}));

vi.mock('../src/services/ProcessRouteService', () => ({
  ProcessRouteService: {
    advanceJourneyByCoil: (...args: unknown[]) => advanceJourneyByCoil(...args),
  },
}));

vi.mock('../src/services/QueueTransferService', () => ({
  QueueTransferService: {
    enqueueActiveStep: (...args: unknown[]) => enqueueActiveStep(...args),
  },
}));

describe('journeyHandoff — Fix 1 guard', () => {
  beforeEach(() => {
    prodRow = null;
    inv1Rows = [];
    strandedRows = [];
    coilRow = null;
    publish.mockClear();
    advanceJourneyByCoil.mockClear();
    enqueueActiveStep.mockClear();
  });

  it('throws when no COMPLETED prod_hrs row', async () => {
    const { assertCompletedHrsPklProd } = await import('../src/services/journeyHandoff');
    await expect(assertCompletedHrsPklProd('HRS', 'C-1')).rejects.toThrow(
      'Save production data before ending order',
    );
  });

  it('returns COMPLETED capture when present', async () => {
    prodRow = { entry_id: '99', shift_log_id: '7' };
    const { assertCompletedHrsPklProd } = await import('../src/services/journeyHandoff');
    await expect(assertCompletedHrsPklProd('PKL', 'C-2')).resolves.toEqual({
      entryId: '99',
      shiftLogId: '7',
    });
  });
});

describe('journeyHandoff — Fix 2 re-emit', () => {
  beforeEach(() => {
    prodRow = { entry_id: '42', shift_log_id: '3' };
    publish.mockClear();
  });

  it('publishes production.captured for HRS', async () => {
    const { emitProductionCaptured } = await import('../src/services/journeyHandoff');
    await emitProductionCaptured('HRS', '3', '42', 'C-HRS');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toMatchObject({
      type: 'production.captured',
      payload: { processCode: 'HRS', shiftLogId: '3', entryId: '42', coilNo: 'C-HRS' },
    });
  });

  it('idempotent double publish uses same key shape', async () => {
    const { emitProductionCaptured } = await import('../src/services/journeyHandoff');
    await emitProductionCaptured('PKL', '1', '8', 'C-PKL');
    await emitProductionCaptured('PKL', '1', '8', 'C-PKL');
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0][0].key).toBe(publish.mock.calls[1][0].key);
  });
});

describe('journeyHandoff — INV-1 backfill', () => {
  beforeEach(() => {
    enqueueActiveStep.mockClear();
    inv1Rows = [
      { coil_no: 'C-CHILD', journey_id: '20', step_no: 1, process_code: 'PKL' },
    ];
    coilRow = {
      coil_no: 'C-CHILD',
      grade_code: 'G1',
      coil_width_mm: 1000,
      coil_thk_mm: 1.2,
      weight_mt: 5,
    };
  });

  it('heals INV-1 violation via enqueueActiveStep', async () => {
    const { backfillInv1Violations } = await import('../src/services/journeyHandoff');
    const healed = await backfillInv1Violations();
    expect(healed).toBe(1);
    expect(enqueueActiveStep).toHaveBeenCalledWith(20, expect.objectContaining({ coil_no: 'C-CHILD' }), {});
  });
});

describe('journeyHandoff — Fix 3 reconcile', () => {
  beforeEach(() => {
    publish.mockClear();
    advanceJourneyByCoil.mockClear();
    advanceJourneyByCoil.mockResolvedValue(null);
    enqueueActiveStep.mockClear();
    inv1Rows = [];
    strandedRows = [];
    prodRow = null;
    coilRow = null;
    lastSql = '';
  });

  it('re-emits when stranded HRS has COMPLETED prod', async () => {
    strandedRows = [
      {
        coil_no: 'C-STRAND',
        journey_id: '10',
        current_step_no: 1,
        stuck_process: 'HRS',
      },
    ];
    prodRow = { entry_id: '55', shift_log_id: '9' };
    const { reconcileStrandedHandoffs } = await import('../src/services/journeyHandoff');
    const healed = await reconcileStrandedHandoffs();
    expect(healed).toBeGreaterThanOrEqual(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].payload).toMatchObject({
      processCode: 'HRS',
      coilNo: 'C-STRAND',
      entryId: '55',
    });
  });

  it('falls back to advanceJourneyByCoil when no prod row', async () => {
    strandedRows = [
      {
        coil_no: 'C-CTL',
        journey_id: '11',
        current_step_no: 3,
        stuck_process: 'CTL',
      },
    ];
    prodRow = null;
    const { reconcileStrandedHandoffs } = await import('../src/services/journeyHandoff');
    const healed = await reconcileStrandedHandoffs();
    expect(healed).toBeGreaterThanOrEqual(1);
    expect(advanceJourneyByCoil).toHaveBeenCalledWith('C-CTL', {});
  });

  it('stranded SQL includes ANN/CRM predicates keyed to charge ADVANCE and current CRM batch', async () => {
    lastSql = '';
    const { findStrandedHandoffs } = await import('../src/services/journeyHandoff');
    await findStrandedHandoffs();
    expect(lastSql).toContain("'HRS', 'PKL', 'RWD', 'CRS', 'CTL', 'ANN', 'CRM'");
    expect(lastSql).toContain('o.batch_id = cur.queue_batch_id');
    expect(lastSql).toContain("ac.status = 'DONE'");
    expect(lastSql).toContain("acc.disposition = 'ADVANCE'");
  });

  it('rescues stranded ANN via advanceJourneyByCoil and records ann_reconcile', async () => {
    const { resetHandoffMetricsForTests, getHandoffMetricsSnapshot } = await import(
      '../src/services/handoffMetrics'
    );
    resetHandoffMetricsForTests();
    strandedRows = [
      { coil_no: 'C-ANN', journey_id: '12', current_step_no: 4, stuck_process: 'ANN' },
    ];
    prodRow = null;
    advanceJourneyByCoil.mockResolvedValue({ journeyId: '12' });
    const { reconcileStrandedHandoffs } = await import('../src/services/journeyHandoff');
    const healed = await reconcileStrandedHandoffs();
    expect(healed).toBeGreaterThanOrEqual(1);
    expect(advanceJourneyByCoil).toHaveBeenCalledWith('C-ANN', {});
    expect(getHandoffMetricsSnapshot()).toMatchObject({
      'handoff_self_heal{action=ann_reconcile}': 1,
    });
  });

  it('rescues stranded CRM via advanceJourneyByCoil and records crm_reconcile', async () => {
    const { resetHandoffMetricsForTests, getHandoffMetricsSnapshot } = await import(
      '../src/services/handoffMetrics'
    );
    resetHandoffMetricsForTests();
    strandedRows = [
      { coil_no: 'C-CRM', journey_id: '13', current_step_no: 2, stuck_process: 'CRM' },
    ];
    prodRow = null;
    advanceJourneyByCoil.mockResolvedValue({ journeyId: '13' });
    const { reconcileStrandedHandoffs } = await import('../src/services/journeyHandoff');
    const healed = await reconcileStrandedHandoffs();
    expect(healed).toBeGreaterThanOrEqual(1);
    expect(advanceJourneyByCoil).toHaveBeenCalledWith('C-CRM', {});
    expect(getHandoffMetricsSnapshot()).toMatchObject({
      'handoff_self_heal{action=crm_reconcile}': 1,
    });
  });

  it('already-advanced coil is a no-op', async () => {
    strandedRows = [];
    const { reconcileStrandedHandoffs } = await import('../src/services/journeyHandoff');
    const healed = await reconcileStrandedHandoffs();
    expect(healed).toBe(0);
    expect(advanceJourneyByCoil).not.toHaveBeenCalled();
  });
});

describe('redriveCoilJourney', () => {
  beforeEach(() => {
    advanceJourneyByCoil.mockReset();
    advanceJourneyByCoil.mockResolvedValue(null);
  });

  it('records tag when advance succeeds', async () => {
    const { resetHandoffMetricsForTests, getHandoffMetricsSnapshot } = await import(
      '../src/services/handoffMetrics'
    );
    resetHandoffMetricsForTests();
    advanceJourneyByCoil.mockResolvedValue({ journeyId: '1' });
    const { redriveCoilJourney } = await import('../src/services/journeyHandoff');
    await redriveCoilJourney('C-1', 'ann_reconcile');
    expect(advanceJourneyByCoil).toHaveBeenCalledWith('C-1', {});
    expect(getHandoffMetricsSnapshot()).toMatchObject({
      'handoff_self_heal{action=ann_reconcile}': 1,
    });
  });

  it('swallows advance errors', async () => {
    advanceJourneyByCoil.mockRejectedValue(new Error('boom'));
    const { redriveCoilJourney } = await import('../src/services/journeyHandoff');
    await expect(redriveCoilJourney('C-1', 'crm_reconcile')).resolves.toBeUndefined();
  });
});

describe('CRM post-commit handoff', () => {
  it('advances after the completion transaction, not inside completeSingleOrder', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/services/SixHiService.ts', import.meta.url), 'utf8');
    const endStart = src.indexOf('static async endProduction(');
    const methodStart = src.indexOf('private static async completeSingleOrder');
    const methodEnd = src.indexOf('\n  static async getEffectiveRuleset', methodStart);
    const endProduction = src.slice(endStart, methodStart);
    const methodBody = src.slice(methodStart, methodEnd);
    expect(methodBody).not.toContain('advanceJourneyByCoil');
    expect(endProduction.indexOf('advanceJourneyByCoil')).toBeGreaterThan(
      endProduction.indexOf('db.transaction()'),
    );
  });
});

describe('handoffMetrics', () => {
  it('increments and snapshots counters', async () => {
    const { recordQueueRenderSkip, getHandoffMetricsSnapshot, resetHandoffMetricsForTests } =
      await import('../src/services/handoffMetrics');
    resetHandoffMetricsForTests();
    recordQueueRenderSkip('PKL', 'No PKL batch');
    expect(getHandoffMetricsSnapshot()).toMatchObject({
      'queue_render_skip{line=PKL,reason=No PKL batch}': 1,
    });
  });
});

describe('JourneyHandoffScheduler', () => {
  it('tick delegates to reconcileStrandedHandoffs', async () => {
    inv1Rows = [];
    strandedRows = [];
    const { JourneyHandoffScheduler } = await import('../src/jobs/JourneyHandoffScheduler');
    const healed = await JourneyHandoffScheduler.tick();
    expect(healed).toBe(0);
  });
});

describe('nextLineBlocksRewind', () => {
  it('allows rewind when next step is still pending', async () => {
    const { nextLineBlocksRewind } = await import('../src/services/journeyHandoff');
    expect(nextLineBlocksRewind('PENDING')).toBe(false);
    expect(nextLineBlocksRewind('PENDING', 'PENDING')).toBe(false);
  });

  it('blocks when next step or order has started', async () => {
    const { nextLineBlocksRewind } = await import('../src/services/journeyHandoff');
    expect(nextLineBlocksRewind('ACTIVE')).toBe(true);
    expect(nextLineBlocksRewind('COMPLETED')).toBe(true);
    expect(nextLineBlocksRewind('PENDING', 'IN_PROGRESS')).toBe(true);
  });
});
