import type { SixHiOrderDetail, SixHiQueueCard } from '@m1/shared-validation';

type OrderIdentitySource = Pick<
  SixHiQueueCard | SixHiOrderDetail,
  'batchNumber' | 'motherCoil' | 'slitId' | 'targetThkMm' | 'finishThkMm'
> & {
  rollFinish?: SixHiQueueCard['rollFinish'];
  ppcRollFinish?: SixHiOrderDetail['ppcRollFinish'];
  coilNo?: string;
};

export function selectIdOf(order: { slitId?: string }): string {
  return order.slitId?.trim() || '—';
}

/** Display: mother coil + slit when slit exists (e.g. "1100038319 A"). */
export function displayMotherCoilId(order: {
  motherCoil?: string;
  batchNumber: string;
  slitId?: string;
  coilNo?: string;
}): string {
  const coil = (order.motherCoil ?? order.coilNo ?? order.batchNumber).trim();
  const slit = order.slitId?.trim();
  return slit ? `${coil} ${slit}` : coil;
}

export function primaryOrderId(order: { motherCoil: string; batchNumber: string }): string {
  return order.motherCoil?.trim() || order.batchNumber;
}

export function finalOutputThicknessOf(order: Pick<OrderIdentitySource, 'finishThkMm' | 'targetThkMm'>): number {
  return order.finishThkMm ?? order.targetThkMm;
}

/** Skin Pass: PPC Pre-Stage Thickness column → input_thk_mm */
export function preStageThicknessOf(order: { subProcess?: string; inputThkMm?: number }): number | undefined {
  if (order.subProcess !== 'SKIN_PASS') return undefined;
  return order.inputThkMm;
}

/** Skin Pass: PPC Skin Pass Thickness column → ppc_thk_mm / targetThkMm */
export function skinPassTargetThicknessOf(order: { subProcess?: string; targetThkMm?: number }): number | undefined {
  if (order.subProcess !== 'SKIN_PASS') return undefined;
  return order.targetThkMm;
}

/** Display label + value for thickness in PPC/order cards (process-aware). */
export function thicknessDisplayForProcess(order: {
  subProcess?: string;
  inputThkMm?: number;
  targetThkMm?: number;
  finishThkMm?: number;
}): { preLabel: string; preValue: number; targetLabel?: string; targetValue?: number } {
  if (order.subProcess === 'SKIN_PASS') {
    return {
      preLabel: 'Pre-Stage Thickness',
      preValue: order.inputThkMm ?? 0,
      targetLabel: 'Target Thickness',
      targetValue: order.targetThkMm,
    };
  }
  return {
    preLabel: 'Input Thickness',
    preValue: order.inputThkMm ?? 0,
    targetLabel: 'Final Output Thickness',
    targetValue: finalOutputThicknessOf(order),
  };
}

export function finishOf(order: Partial<Pick<SixHiQueueCard, 'rollFinish'>> & Partial<Pick<SixHiOrderDetail, 'ppcRollFinish'>>): string {
  return order.rollFinish ?? order.ppcRollFinish ?? '—';
}

/** Finish-surface family: LOW_MATT ≡ MATT, MIRROR ≡ BRIGHT (must match server finishGroup). */
export function finishGroupOf(value: string | null | undefined): string {
  const s = (value?.trim() || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (s === 'M' || s === 'MATTE' || s.includes('MATT')) return 'MATT';
  if (s === 'B' || s === 'BRIGHT' || s === 'MIRROR') return 'BRIGHT';
  return s;
}

/** Combined-run identity: Mother Coil + Slit + Finish-family (thickness excluded). */
export function combinedRunKey(
  order: OrderIdentitySource & { subProcess?: string; inputThkMm?: number },
): string {
  const coil = (order.motherCoil ?? order.coilNo ?? order.batchNumber)?.trim() || '';
  const slit = order.slitId?.trim() || '';
  return [coil, slit, finishGroupOf(finishOf(order))].join('|');
}

export function isCompatibleCombinedRunOrder(base: OrderIdentitySource, candidate: OrderIdentitySource): boolean {
  return combinedRunKey(base) === combinedRunKey(candidate);
}

export function orderIdentitySubtitle(order: OrderIdentitySource): string {
  return `Batch ${order.batchNumber}`;
}
