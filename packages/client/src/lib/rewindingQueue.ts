export interface RewindingQueueCard {
  batchNumber: string;
  coilNo: string;
  displayCoilNo: string;
  slitId?: string;
  customerName: string;
  gradeCode: string;
  widthMm: number;
  thicknessMm: number;
  weightMt: number;
  surfaceFinish?: 'M' | 'B';
  planDate?: string;
  shiftCode?: string;
  status?: string;
  machineCode?: string;
  machineAllocated?: boolean;
  combinedGroupId?: string;
}

/** Prefill shape RwdTensionForm already understands (Plan-sourced fields). */
export function rewindingCardToPrefill(card: RewindingQueueCard): Record<string, unknown> {
  return {
    displayCoilNo: card.displayCoilNo,
    customerName: { value: card.customerName, source: 'Plan' },
    gradeCode: { value: card.gradeCode, source: 'Plan' },
    widthMm: { value: card.widthMm, source: 'Plan' },
    thicknessMm: { value: card.thicknessMm, source: 'Plan' },
    outputThkMmFallback: { value: card.thicknessMm, source: 'Plan' },
    weightMt: { value: card.weightMt, source: 'Plan' },
    batchNumber: { value: card.batchNumber, source: 'Plan' },
    ...(card.slitId ? { slitId: { value: card.slitId, source: 'Plan' } } : {}),
    ...(card.surfaceFinish
      ? { surfaceFinish: { value: card.surfaceFinish, source: 'Plan' } }
      : {}),
  };
}

/**
 * Prefer the live production batch for a coil over AutoSource's "latest plan row"
 * (which can be a different PENDING sibling and leave the rail stuck on Idle).
 */
export function pickRewindingBatchForCoil(
  queue: RewindingQueueCard[],
  coilNo: string,
  preferredBatch?: string,
): RewindingQueueCard | undefined {
  const forCoil = queue.filter((c) => c.coilNo === coilNo || c.displayCoilNo === coilNo);
  if (preferredBatch) {
    const hit = forCoil.find((c) => c.batchNumber === preferredBatch) ?? queue.find((c) => c.batchNumber === preferredBatch);
    if (hit) return hit;
  }
  const active = forCoil.find((c) => {
    const s = (c.status ?? '').toUpperCase();
    return s === 'IN_PROGRESS' || s === 'STOPPAGE';
  });
  if (active) return active;
  const preparing = forCoil.find((c) => (c.status ?? '').toUpperCase() === 'PREPARING');
  return preparing ?? forCoil[0];
}
