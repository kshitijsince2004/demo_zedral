import { describe, it, expect, vi, beforeEach } from 'vitest';

const advanceJourneyByCoil = vi.fn().mockResolvedValue(null);

// Mock DB access for transitionAnnCharge.
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
          return { status: 'RW' };
        }
        if (table === 'planning.order_journey') {
          // ctx.coil_no is set from where('coil_no', '=', ...)
          return ctx.coil_no === 'C1'
            ? { journey_id: 10, current_step_no: 2 }
            : { journey_id: 20, current_step_no: 2 };
        }
        if (table === 'planning.order_journey_step') {
          // determined by where('journey_id', '=', ...)
          return String(ctx.journey_id) === '10' ? { status: 'ACTIVE' } : null;
        }
        return null;
      },
      execute: async () => {
        if (table === 'txn.ann_charge_coil') {
          return [{ coil_no: 'C1' }, { coil_no: 'C2' }];
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

  it('advances only coils whose ANN step is currently ACTIVE', async () => {
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');
    const { ProcessStationService } = await import('../src/services/ProcessStationService');

    vi.spyOn(ProcessRouteService, 'advanceJourneyByCoil').mockImplementation(advanceJourneyByCoil as any);

    await ProcessStationService.transitionAnnCharge('CH-1', 'DONE', {});

    // C1 has ACTIVE ANN step; C2 is not currently at ANN => should not advance.
    expect(advanceJourneyByCoil).toHaveBeenCalledTimes(1);
    expect(advanceJourneyByCoil).toHaveBeenCalledWith('C1', {});
  });
});

