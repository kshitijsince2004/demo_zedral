import { describe, it, expect, vi, beforeEach } from 'vitest';

const advanceJourneyByCoil = vi.fn().mockResolvedValue(null);

const dbMock = {
  selectFrom: vi.fn((table: string) => {
    const ctx: Record<string, any> = {};

    const builder: any = {
      select: () => builder,
      selectAll: () => builder,
      innerJoin: () => builder,
      orderBy: () => builder,
      where: (col: string, _op: string, val: any) => {
        ctx[col] = val;
        return builder;
      },
      executeTakeFirst: async () => {
        if (table === 'txn.ann_charge') {
          return { status: 'IN_PROCESS' };
        }
        if (table === 'planning.order_journey') {
          return ctx.coil_no === 'C1' || ctx.coil_no === 'C3'
            ? { journey_id: ctx.coil_no === 'C1' ? 10 : 30, current_step_no: 2 }
            : { journey_id: 20, current_step_no: 2 };
        }
        if (table === 'planning.order_journey_step') {
          return String(ctx.journey_id) === '10' || String(ctx.journey_id) === '30'
            ? { status: 'ACTIVE' }
            : null;
        }
        return null;
      },
      execute: async () => {
        if (table === 'txn.ann_charge_coil') {
          return [
            { coil_no: 'C1', disposition: 'ADVANCE' },
            { coil_no: 'C2', disposition: 'ADVANCE' },
            { coil_no: 'C3', disposition: 'HOLD' },
          ];
        }
        if (table === 'txn.ann_charge_coil as acc') {
          return [{ weight_mt: 1 }, { weight_mt: 2 }];
        }
        return [];
      },
    };

    return builder;
  }),
  updateTable: vi.fn(() => {
    const ub: any = {
      set: () => ub,
      where: () => ub,
      execute: async () => undefined,
    };
    return ub;
  }),
};

vi.mock('../src/db', () => ({
  db: dbMock,
}));

describe('ANN charge DONE fan-out', () => {
  beforeEach(() => {
    advanceJourneyByCoil.mockClear();
  });

  it('advances ADVANCE coils with ACTIVE ANN step; skips HOLD', async () => {
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');
    const { ProcessStationService } = await import('../src/services/ProcessStationService');

    vi.spyOn(ProcessRouteService, 'advanceJourneyByCoil').mockImplementation(advanceJourneyByCoil as any);

    await ProcessStationService.transitionAnnCharge('CH-1', 'DONE', {});

    expect(advanceJourneyByCoil).toHaveBeenCalledTimes(1);
    expect(advanceJourneyByCoil).toHaveBeenCalledWith('C1', {});
  });
});

describe('ANN stage totals', () => {
  it('sums non-skipped duration_min', () => {
    const stages = [
      { duration_min: 10, skipped: false },
      { duration_min: 20, skipped: false },
      { duration_min: 5, skipped: true },
      { duration_min: null, skipped: false },
    ];
    const total = stages.filter((s) => !s.skipped).reduce((sum, s) => sum + Number(s.duration_min ?? 0), 0);
    expect(total).toBe(30);
  });
});
