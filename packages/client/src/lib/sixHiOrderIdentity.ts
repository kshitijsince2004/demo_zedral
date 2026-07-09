import type { SixHiOrderDetail, SixHiQueueCard } from '@m1/shared-validation';

type OrderIdentitySource = Pick<
  SixHiQueueCard | SixHiOrderDetail,
  'batchNumber' | 'motherCoil' | 'slitId' | 'targetThkMm' | 'finishThkMm'
> & {
  rollFinish?: SixHiQueueCard['rollFinish'];
  ppcRollFinish?: SixHiOrderDetail['ppcRollFinish'];
};

export function selectIdOf(order: { slitId?: string }): string {
  return order.slitId?.trim() || '—';
}

export function primaryOrderId(order: { motherCoil: string; batchNumber: string }): string {
  return order.motherCoil?.trim() || order.batchNumber;
}

export function finalOutputThicknessOf(order: Pick<OrderIdentitySource, 'finishThkMm' | 'targetThkMm'>): number {
  return order.finishThkMm ?? order.targetThkMm;
}

export function finishOf(order: Partial<Pick<SixHiQueueCard, 'rollFinish'>> & Partial<Pick<SixHiOrderDetail, 'ppcRollFinish'>>): string {
  return order.rollFinish ?? order.ppcRollFinish ?? '—';
}

export function combinedRunKey(order: OrderIdentitySource): string {
  return [
    primaryOrderId(order),
    selectIdOf(order),
    finishOf(order),
    finalOutputThicknessOf(order),
  ].join('|');
}

export function isCompatibleCombinedRunOrder(base: OrderIdentitySource, candidate: OrderIdentitySource): boolean {
  return combinedRunKey(base) === combinedRunKey(candidate);
}

export function orderIdentitySubtitle(order: OrderIdentitySource): string {
  return `Slit ID ${selectIdOf(order)} · Batch ${order.batchNumber}`;
}
