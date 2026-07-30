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

const dbMock = {
  selectFrom: vi.fn((table: string) => {
    // Reset per query builder.
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
          return { batch_number: 'BATCH-1', coil_no: 'COIL-1' };
        }
        if (table === 'planning.order_journey') {
          return { journey_id: 1, current_step_no: 2, status: 'ACTIVE' };
        }
        if (table === 'planning.order_journey_step') {
          if (stepNoOp === '=') {
            return { step_id: 10, queue_batch_id: 200, step_no: 2 };
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

describe('CRS For-CTL routing', () => {
  beforeEach(() => {
    enqueueNextStep.mockClear();
  });

  it('ignores SKIPPED steps when selecting the next journey step', async () => {
    const { ProcessRouteService } = await import('../src/services/ProcessRouteService');

    // Avoid toView DB reads.
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
  });
});

