import type { SixHiQueueCard, SixHiOrderDetail, SixHiOrderStatus } from '@m1/shared-validation';
import type { CombinedProductionRun } from '../store/sixHiStore';
import { isCompatibleCombinedRunOrder } from './sixHiOrderIdentity';
import { apiClient } from './apiClient';

export type CombinedStoppageMode = 'start' | 'manage';

/** Status buckets that may auto-combine together (same bucket + compatibility key). */
export const COMBINE_STATUS_GROUPS: SixHiOrderStatus[][] = [
  ['PENDING', 'PREPARING'],
  ['IN_PROGRESS', 'STOPPAGE'],
  ['COMPLETED'],
  ['REJECTED'],
];

const STATUS_TO_GROUP = new Map<SixHiOrderStatus, number>(
  COMBINE_STATUS_GROUPS.flatMap((statuses, groupIndex) =>
    statuses.map((status) => [status, groupIndex] as const),
  ),
);

export function combineStatusGroup(status: SixHiOrderStatus): number | null {
  return STATUS_TO_GROUP.get(status) ?? null;
}

export function ordersShareCombineGroup(a: SixHiQueueCard, b: SixHiQueueCard): boolean {
  if (a.subProcess !== b.subProcess) return false;
  if (!isCompatibleCombinedRunOrder(a, b)) return false;
  const groupA = combineStatusGroup(a.status);
  const groupB = combineStatusGroup(b.status);
  return groupA != null && groupA === groupB;
}

export function findCompatibleOrdersForCombine(
  anchor: SixHiQueueCard,
  queueCards: SixHiQueueCard[],
  machineCode?: string,
): SixHiQueueCard[] {
  const matches = queueCards.filter((candidate) => ordersShareCombineGroup(anchor, candidate));
  const scoped = machineCode
    ? matches.filter(
        (c) => c.batchNumber === anchor.batchNumber || c.machineCode === machineCode || !c.machineCode,
      )
    : matches;
  return scoped.length > 0 ? scoped : [anchor];
}

export function buildCombinedRunFromCards(
  cards: SixHiQueueCard[],
  primaryBatchNumber: string,
): CombinedProductionRun | null {
  if (cards.length <= 1) return null;
  const primary = cards.find((c) => c.batchNumber === primaryBatchNumber) ?? cards[0];
  return {
    primaryBatchNumber: primary.batchNumber,
    batchNumbers: cards.map((c) => c.batchNumber),
    orders: cards.map((c) => ({
      batchNumber: c.batchNumber,
      motherCoil: c.motherCoil,
      slitId: c.slitId,
      customer: c.customer,
      weightMt: c.weightMt,
    })),
  };
}

/** Shrink a matching run to the operator's picked subset (after start, or explicit pick). */
export function buildCombinedRunFromSelected(
  run: CombinedProductionRun,
  selectedBatches: string[],
): CombinedProductionRun | null {
  const selected = selectedBatches.filter((b) => run.batchNumbers.includes(b));
  if (selected.length <= 1) return null;
  const primary = selected.includes(run.primaryBatchNumber) ? run.primaryBatchNumber : selected[0];
  return {
    primaryBatchNumber: primary,
    batchNumbers: selected,
    orders: run.orders.filter((o) => selected.includes(o.batchNumber)),
  };
}

/**
 * Matching list vs picked list reconcile (selectable-orders fix).
 * - New / unrelated group → all matching ticked
 * - Same group refresh → keep ticks ∩ matching (new arrivals stay unticked)
 * - Auto-heal primary when the main order was unticked
 */
export function reconcileCombinedSelection(
  prevRun: CombinedProductionRun | null,
  prevSelected: string[],
  newRun: CombinedProductionRun | null,
  forcedSelected?: string[],
): { combinedRun: CombinedProductionRun | null; combinedSelectedBatches: string[] } {
  if (!newRun) {
    return { combinedRun: null, combinedSelectedBatches: [] };
  }

  const matching = new Set(newRun.batchNumbers);
  const sameGroup = !!prevRun && newRun.batchNumbers.some((b) => prevRun.batchNumbers.includes(b));

  let selection: string[];
  if (forcedSelected) {
    selection = forcedSelected.filter((b) => matching.has(b));
  } else if (sameGroup) {
    selection = prevSelected.filter((b) => matching.has(b));
  } else {
    selection = [...newRun.batchNumbers];
  }

  let run = newRun;
  if (selection.length > 0 && !selection.includes(run.primaryBatchNumber)) {
    run = { ...run, primaryBatchNumber: selection[0] };
  }

  return { combinedRun: run, combinedSelectedBatches: selection };
}

/** Find siblings on the same machine that share the combined-run compatibility key. */
export function detectCombinedRunFromQueue(
  queueCards: SixHiQueueCard[],
  machineCode: string,
  anchorBatchNumber: string,
): CombinedProductionRun | null {
  const anchor = queueCards.find((c) => c.batchNumber === anchorBatchNumber);
  if (!anchor) return null;

  const siblings = findCompatibleOrdersForCombine(anchor, queueCards, machineCode);

  return buildCombinedRunFromCards(siblings, anchorBatchNumber);
}

export function dedupeQueueCards(cards: SixHiQueueCard[]): SixHiQueueCard[] {
  const byBatch = new Map<string, SixHiQueueCard>();
  for (const card of cards) {
    byBatch.set(card.batchNumber, card);
  }
  return Array.from(byBatch.values());
}

export function cardsShareProductionAction(cards: SixHiQueueCard[]): boolean {
  if (cards.length <= 1) return false;
  const group = combineStatusGroup(cards[0].status);
  if (group == null) return false;
  return cards.every((c) => combineStatusGroup(c.status) === group);
}

export function combinedActionLabel(cards: SixHiQueueCard[]): string {
  if (cards.length <= 1) return 'Open';
  const status = cards[0].status;
  if (status === 'PENDING' || status === 'PREPARING') return 'Move Combined to Preparing';
  if (status === 'COMPLETED' || status === 'REJECTED') return 'View Combined History';
  if (status === 'IN_PROGRESS' || status === 'STOPPAGE') return 'Open Combined Production';
  return 'Open Combined';
}

/** Orders that can receive a new stoppage (running, no open stoppage). */
export function filterStoppageStartTargets(orders: SixHiOrderDetail[]): string[] {
  return orders
    .filter((order) => order.status === 'IN_PROGRESS' && !order.activeStoppage)
    .map((order) => order.batchNumber);
}

/** Orders with an open stoppage to update or end. */
export function filterStoppageManageTargets(orders: SixHiOrderDetail[]): string[] {
  return orders
    .filter((order) => !!order.activeStoppage)
    .map((order) => order.batchNumber);
}

export async function resolveCombinedStoppageTargets(
  batchNumbers: string[],
  mode: CombinedStoppageMode,
  fallbackBatch?: string,
): Promise<string[]> {
  if (batchNumbers.length <= 1) return batchNumbers;

  const orders = await Promise.all(
    batchNumbers.map((batchNumber) =>
      apiClient.get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNumber)}`),
    ),
  );

  const eligible = mode === 'start'
    ? filterStoppageStartTargets(orders)
    : filterStoppageManageTargets(orders);

  if (eligible.length > 0) return eligible;
  if (fallbackBatch) return [fallbackBatch];
  return batchNumbers.slice(0, 1);
}
