import { describe, it, expect, vi, beforeEach } from 'vitest';

const enqueueNextStep = vi.fn().mockResolvedValue(123);

// Mock QueueTransferService so advanceJourney doesn't touch other DB code paths.
vi.mock('../src/services/QueueTransferService', () => ({
  QueueTransferService: {
    enqueueNextStep,
  },
}));

type NextStep = { step_id: number; step_no: number; route_code: string; queue_batch_id: number | null; process_code?: string | null };

let hasSkipFilter = false;
let stepNoOp: '=' | '>' | null = null;
const stepUpdates: Array<Record<string, unknown>> = [];

function makeSelectFrom(batchId: number) {
  return vi.fn((table: string) => {
    hasSkipFilter = false;
    stepNoOp = null;

    const builder: any = {
      selectAll: () => builder,
      select: () => builder,
      where: (col: string, op: string, val: any) => {
        if (table === 'planning.order_journey_step') {
          if (col === 'step_no') {
            if (op === '=') stepNoOp = '=';
            if (op === '>') stepNoOp = '>';
          }
          if (col === 'status' && op === '!=' && val === 'SKIPPED') {
            hasSkipFilter = true;
          }
        }
        return builder;
      },
      orderBy: () => builder,
      executeTakeFirst: async () => {
        if (table === 'planning.ppc_batch') {
          return { batch_id: batchId, batch_number: 'BATCH-1', coil_no: 'COIL-1' };
        }
        if (table === 'planning.order_journey') {
          return { journey_id: 1, current_step_no: 2, status: 'ACTIVE' };
        }
        if (table === 'planning.order_journey_step') {
          if (stepNoOp === '=') {
            return { step_id: 10, queue_batch_id: 200, step_no: 2, machine_code: 'CRS' };
          }
          if (stepNoOp === '>') {
            const next: NextStep = hasSkipFilter
              ? { step_id: 20, step_no: 3, route_code: 'LE', queue_batch_id: null, process_code: 'CTL' }
              : { step_id: 19, step_no: 3, route_code: 'PKG', queue_batch_id: null, process_code: null };
            return next;
          }
        }
        return null;
      },
    };

    return builder;
  });
}

const dbMock = {
  selectFrom: makeSelectFrom(200),
  updateTable: vi.fn((table: string) => {
    const ub: any = {
      set: (vals: Record<string, unknown>) => {
        if (table === 'planning.order_journey_step') stepUpdates.push(vals);
        return ub;
      },
      where: () => ub,
      execute: async () => undefined,
    };
    return ub;
  }),
  transaction: () => ({
    execute: async (fn: (trx: typeof dbMock) => Promise<unknown>) => fn(dbMock),
  }),
};

vi.mock('../src/db', () => ({
  db: dbMock,
}));

describe('CRS For-CTL routing', () => {
  beforeEach(() => {
    enqueueNextStep.mockClear();
    stepUpdates.length = 0;
    dbMock.selectFrom = makeSelectFrom(200);
  });

  it('ignores SKIPPED steps when selecting the next journey step', async () => {
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');

    vi.spyOn(ProcessRouteService, 'toView').mockResolvedValue({
      journeyId: '1',
      coilNo: 'COIL-1',
      status: 'ACTIVE',
      currentStepNo: 3,
      steps: [],
    });

    await ProcessRouteService.advanceJourney('BATCH-1', { actualWeightMt: 10 });

    const [, , nextStep] = enqueueNextStep.mock.calls[0];
    expect(nextStep.route_code).toBe('LE');
    expect(stepUpdates.some((u) => u.status === 'ACTIVE' && u.queue_batch_id === 123)).toBe(true);
  });

  it('aborts when completing batch does not match current step queue_batch_id', async () => {
    dbMock.selectFrom = makeSelectFrom(999);

    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');
    const result = await ProcessRouteService.advanceJourney('BATCH-1', {});
    expect(result).toBeNull();
    expect(enqueueNextStep).not.toHaveBeenCalled();
  });
});
