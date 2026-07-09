import { describe, expect, it } from 'vitest';
import type { SixHiQueueCard } from '@m1/shared-validation';
import {
  buildCombinedRunFromCards,
  cardsShareProductionAction,
  detectCombinedRunFromQueue,
  findCompatibleOrdersForCombine,
  filterStoppageManageTargets,
  filterStoppageStartTargets,
  ordersShareCombineGroup,
} from '../../src/lib/combinedProductionRun';
import type { SixHiOrderDetail } from '@m1/shared-validation';

function card(overrides: Partial<SixHiQueueCard> & Pick<SixHiQueueCard, 'batchNumber'>): SixHiQueueCard {
  return {
    motherCoil: 'MC-001',
    slitId: 'S1',
    customer: 'Customer',
    grade: 'G1',
    widthMm: 1000,
    inputThkMm: 2,
    targetThkMm: 1,
    finishThkMm: 1,
    rollFinish: 'MATT',
    weightMt: 10,
    status: 'PENDING',
    subProcess: 'ROLLING',
    queuePosition: 1,
    machineCode: '6HI',
    machineAllocated: true,
    ...overrides,
  };
}

describe('combinedProductionRun', () => {
  it('selects more than two compatible pending orders', () => {
    const anchor = card({ batchNumber: 'B1', queuePosition: 1 });
    const queue = [
      anchor,
      card({ batchNumber: 'B2', queuePosition: 2 }),
      card({ batchNumber: 'B3', queuePosition: 3 }),
      card({ batchNumber: 'B4', queuePosition: 4, slitId: 'S2' }),
    ];
    const selected = findCompatibleOrdersForCombine(anchor, queue);
    expect(selected).toHaveLength(3);
    expect(selected.map((o) => o.batchNumber)).toEqual(['B1', 'B2', 'B3']);
  });

  it('combines pending with preparing in the same group', () => {
    const anchor = card({ batchNumber: 'B1', status: 'PENDING' });
    const preparing = card({ batchNumber: 'B2', status: 'PREPARING', queuePosition: 2 });
    expect(ordersShareCombineGroup(anchor, preparing)).toBe(true);
  });

  it('combines completed orders with the same compatibility key', () => {
    const a = card({ batchNumber: 'B1', status: 'COMPLETED' });
    const b = card({ batchNumber: 'B2', status: 'COMPLETED', queuePosition: 2 });
    const c = card({ batchNumber: 'B3', status: 'COMPLETED', queuePosition: 3 });
    expect(findCompatibleOrdersForCombine(a, [a, b, c])).toHaveLength(3);
  });

  it('combines rejected orders with the same compatibility key', () => {
    const a = card({ batchNumber: 'B1', status: 'REJECTED' });
    const b = card({ batchNumber: 'B2', status: 'REJECTED', queuePosition: 2 });
    expect(findCompatibleOrdersForCombine(a, [a, b])).toHaveLength(2);
  });

  it('does not combine orders in different status groups', () => {
    const pending = card({ batchNumber: 'B1', status: 'PENDING' });
    const completed = card({ batchNumber: 'B2', status: 'COMPLETED', queuePosition: 2 });
    expect(ordersShareCombineGroup(pending, completed)).toBe(false);
  });

  it('does not impose a maximum combined count', () => {
    const anchor = card({ batchNumber: 'B0' });
    const queue = Array.from({ length: 6 }, (_, i) =>
      card({ batchNumber: `B${i}`, queuePosition: i + 1 }),
    );
    expect(findCompatibleOrdersForCombine(anchor, queue)).toHaveLength(6);
  });

  it('detects shared production action across status groups', () => {
    expect(cardsShareProductionAction([
      card({ batchNumber: 'B1', status: 'PENDING' }),
      card({ batchNumber: 'B2', status: 'PREPARING', queuePosition: 2 }),
    ])).toBe(true);
    expect(cardsShareProductionAction([
      card({ batchNumber: 'B1', status: 'PENDING' }),
      card({ batchNumber: 'B2', status: 'COMPLETED', queuePosition: 2 }),
    ])).toBe(false);
  });

  it('filters stoppage start targets to running orders without active stoppage', () => {
    const orders = [
      { batchNumber: 'A', status: 'IN_PROGRESS', activeStoppage: undefined },
      { batchNumber: 'B', status: 'STOPPAGE', activeStoppage: { id: 's1' } },
      { batchNumber: 'C', status: 'COMPLETED', activeStoppage: undefined },
    ] as SixHiOrderDetail[];
    expect(filterStoppageStartTargets(orders)).toEqual(['A']);
  });

  it('filters stoppage manage targets to orders with active stoppage', () => {
    const orders = [
      { batchNumber: 'A', status: 'IN_PROGRESS', activeStoppage: undefined },
      { batchNumber: 'B', status: 'STOPPAGE', activeStoppage: { id: 's1' } },
    ] as SixHiOrderDetail[];
    expect(filterStoppageManageTargets(orders)).toEqual(['B']);
  });

  it('excludes orders assigned to a different machine from auto-combine', () => {
    const anchor = card({ batchNumber: 'B1', machineCode: '6HI' });
    const queue = [
      anchor,
      card({ batchNumber: 'B2', queuePosition: 2, machineCode: '6HI' }),
      card({ batchNumber: 'B3', queuePosition: 3, machineCode: '4HI' }),
    ];
    expect(findCompatibleOrdersForCombine(anchor, queue, '6HI').map((o) => o.batchNumber)).toEqual(['B1', 'B2']);
  });

  it('includes unassigned machine orders in auto-combine for the current mill', () => {
    const anchor = card({ batchNumber: 'B1', machineCode: '6HI' });
    const queue = [
      anchor,
      card({ batchNumber: 'B2', queuePosition: 2, machineCode: undefined, machineAllocated: false }),
    ];
    expect(findCompatibleOrdersForCombine(anchor, queue, '6HI')).toHaveLength(2);
  });

  it('detectCombinedRunFromQueue matches hub machine scoping', () => {
    const cards = [
      card({ batchNumber: 'B1', status: 'IN_PROGRESS' }),
      card({ batchNumber: 'B2', status: 'IN_PROGRESS', queuePosition: 2 }),
      card({ batchNumber: 'B3', status: 'IN_PROGRESS', queuePosition: 3, machineCode: '4HI' }),
    ];
    const run = detectCombinedRunFromQueue(cards, '6HI', 'B1');
    expect(run?.batchNumbers).toEqual(['B1', 'B2']);
  });

  it('shows STOPPAGE siblings under IN_PROGRESS filter semantics via status group', () => {
    const running = card({ batchNumber: 'B1', status: 'IN_PROGRESS' });
    const stopped = card({ batchNumber: 'B2', status: 'STOPPAGE', queuePosition: 2 });
    expect(ordersShareCombineGroup(running, stopped)).toBe(true);
  });

  describe('auto-combine for 2+ orders', () => {
    /** Mirrors SixHiHub.applyCombinedSelection */
    function simulateAutoCombine(anchor: SixHiQueueCard, allOrders: SixHiQueueCard[], machineCode?: string) {
      return findCompatibleOrdersForCombine(anchor, allOrders, machineCode).map((o) => o.batchNumber);
    }

    it('auto-selects exactly two compatible pending orders', () => {
      const anchor = card({ batchNumber: 'B1' });
      const allOrders = [
        anchor,
        card({ batchNumber: 'B2', queuePosition: 2 }),
      ];
      expect(simulateAutoCombine(anchor, allOrders, '6HI')).toEqual(['B1', 'B2']);
    });

    it('auto-selects three or more compatible orders in every status group', () => {
      const cases: Array<{ status: SixHiQueueCard['status']; batches: string[] }> = [
        { status: 'PENDING', batches: ['P1', 'P2', 'P3'] },
        { status: 'PREPARING', batches: ['R1', 'R2', 'R3', 'R4'] },
        { status: 'IN_PROGRESS', batches: ['L1', 'L2', 'L3'] },
        { status: 'STOPPAGE', batches: ['S1', 'S2'] },
        { status: 'COMPLETED', batches: ['C1', 'C2', 'C3'] },
        { status: 'REJECTED', batches: ['X1', 'X2'] },
      ];

      for (const { status, batches } of cases) {
        const allOrders = batches.map((batchNumber, i) =>
          card({ batchNumber, status, queuePosition: i + 1 }),
        );
        const selected = simulateAutoCombine(allOrders[0], allOrders, '6HI');
        expect(selected).toHaveLength(batches.length);
        expect(selected).toEqual(batches);
      }
    });

    it('buildCombinedRunFromCards supports two orders and preserves anchor as primary', () => {
      const cards = [
        card({ batchNumber: 'B1', customer: 'A' }),
        card({ batchNumber: 'B2', queuePosition: 2, customer: 'B' }),
      ];
      const run = buildCombinedRunFromCards(cards, 'B2');
      expect(run).not.toBeNull();
      expect(run?.primaryBatchNumber).toBe('B2');
      expect(run?.batchNumbers).toEqual(['B1', 'B2']);
      expect(run?.orders).toHaveLength(2);
    });

    it('buildCombinedRunFromCards supports four or more orders', () => {
      const cards = Array.from({ length: 5 }, (_, i) =>
        card({ batchNumber: `B${i + 1}`, queuePosition: i + 1, weightMt: i + 1 }),
      );
      const run = buildCombinedRunFromCards(cards, 'B3');
      expect(run?.batchNumbers).toEqual(['B1', 'B2', 'B3', 'B4', 'B5']);
      expect(run?.primaryBatchNumber).toBe('B3');
      expect(run?.orders.map((o) => o.weightMt)).toEqual([1, 2, 3, 4, 5]);
    });

    it('buildCombinedRunFromCards returns null for a single order', () => {
      expect(buildCombinedRunFromCards([card({ batchNumber: 'B1' })], 'B1')).toBeNull();
    });

    it('detectCombinedRunFromQueue groups three in-progress orders on the same machine', () => {
      const cards = [
        card({ batchNumber: 'B1', status: 'IN_PROGRESS' }),
        card({ batchNumber: 'B2', status: 'IN_PROGRESS', queuePosition: 2 }),
        card({ batchNumber: 'B3', status: 'IN_PROGRESS', queuePosition: 3 }),
        card({ batchNumber: 'B4', status: 'IN_PROGRESS', queuePosition: 4, slitId: 'S2' }),
      ];
      const run = detectCombinedRunFromQueue(cards, '6HI', 'B2');
      expect(run?.primaryBatchNumber).toBe('B2');
      expect(run?.batchNumbers).toEqual(['B1', 'B2', 'B3']);
    });

    it('refreshes auto-combine when a third compatible order appears in the queue', () => {
      const anchor = card({ batchNumber: 'B1' });
      const initialQueue = [anchor, card({ batchNumber: 'B2', queuePosition: 2 })];
      expect(simulateAutoCombine(anchor, initialQueue, '6HI')).toEqual(['B1', 'B2']);

      const expandedQueue = [
        ...initialQueue,
        card({ batchNumber: 'B3', queuePosition: 3 }),
      ];
      expect(simulateAutoCombine(anchor, expandedQueue, '6HI')).toEqual(['B1', 'B2', 'B3']);
    });

    it('mixes PENDING and PREPARING in one auto-combined group of three', () => {
      const allOrders = [
        card({ batchNumber: 'B1', status: 'PENDING' }),
        card({ batchNumber: 'B2', status: 'PREPARING', queuePosition: 2 }),
        card({ batchNumber: 'B3', status: 'PENDING', queuePosition: 3 }),
      ];
      expect(simulateAutoCombine(allOrders[0], allOrders, '6HI')).toEqual(['B1', 'B2', 'B3']);
    });

    it('mixes IN_PROGRESS and STOPPAGE in one auto-combined group of three', () => {
      const allOrders = [
        card({ batchNumber: 'B1', status: 'IN_PROGRESS' }),
        card({ batchNumber: 'B2', status: 'STOPPAGE', queuePosition: 2 }),
        card({ batchNumber: 'B3', status: 'IN_PROGRESS', queuePosition: 3 }),
      ];
      const run = detectCombinedRunFromQueue(allOrders, '6HI', 'B1');
      expect(run?.batchNumbers).toEqual(['B1', 'B2', 'B3']);
    });
  });
});
