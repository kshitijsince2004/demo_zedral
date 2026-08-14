import type { SixHiOrderDetail, SixHiQueueCard } from '@m1/shared-validation';

type OrderIdentitySource = Pick<
  SixHiQueueCard | SixHiOrderDetail,
  'batchNumber' | 'motherCoil' | 'slitId' | 'targetThkMm' | 'finishThkMm'
> & {
  rollFinish?: SixHiQueueCard['rollFinish'];
  ppcRollFinish?: SixHiOrderDetail['ppcRollFinish'];
  coilNo?: string;
  motherCoilNo?: string;
  displayCoilNo?: string;
};

export function selectIdOf(order: { slitId?: string }): string {
  return normalizeSlit(order.slitId) || '—';
}

/**
 * Coerce API / prefill scalars for UI. Nested `{ value }` and snake_case
 * identity objects must never render as "[object Object]".
 */
export function asDisplayText(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const s = String(value).trim();
    return s === '[object Object]' ? '' : s;
  }
  if (typeof value !== 'object') return '';
  const rec = value as Record<string, unknown>;
  if ('value' in rec) return asDisplayText(rec.value);
  for (const k of [
    'coilNo', 'coil_no', 'motherCoil', 'mother_coil', 'motherCoilNo', 'displayCoilNo',
    'batchNumber', 'batch_number', 'label', 'name',
  ]) {
    if (k in rec) {
      const inner = asDisplayText(rec[k]);
      if (inner) return inner;
    }
  }
  return '';
}

function identityField(order: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const text = asDisplayText(order[k]);
    if (text) return text;
  }
  return '';
}

/** Empty / dash placeholders = no slit (never render "1100038348 -"). */
function normalizeSlit(slit: unknown): string {
  const s = asDisplayText(slit).toUpperCase();
  if (!s || s === '-' || s === '—') return '';
  return s;
}

/**
 * Display: mother coil + slit when slit exists (e.g. "1100038319 A").
 * Coil resolution: motherCoil ?? motherCoilNo ?? displayCoilNo ?? coilNo ?? batchNumber.
 * Guards against double-append when displayCoilNo already ends with the slit token.
 */
export function displayMotherCoilId(order: {
  motherCoil?: unknown;
  motherCoilNo?: unknown;
  displayCoilNo?: unknown;
  batchNumber?: unknown;
  slitId?: unknown;
  coilNo?: unknown;
  [key: string]: unknown;
}): string {
  const rec = order as Record<string, unknown>;
  const coil = identityField(
    rec,
    'motherCoil', 'mother_coil',
    'motherCoilNo', 'mother_coil_no',
    'displayCoilNo', 'display_coil_no',
    'coilNo', 'coil_no',
    'batchNumber', 'batch_number',
  );
  const slit = normalizeSlit(order.slitId ?? rec.slit_id);
  if (!slit) return coil;
  // Slit already encoded as a dash suffix on the resolved id (canonical mother-slit child coils,
  // e.g. "110038829-C"). Same rule as parseCoilIdentity's -([A-Za-z0-9]{1,4})$. Prevents "…-C C".
  if (coil.toUpperCase().endsWith(`-${slit}`)) return coil;
  const tokens = coil.split(/\s+/);
  if (tokens[tokens.length - 1]?.toUpperCase() === slit) return coil;
  return `${coil} ${slit}`;
}

export function primaryOrderId(order: { motherCoil?: unknown; batchNumber?: unknown }): string {
  return asDisplayText(order.motherCoil) || asDisplayText(order.batchNumber);
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
  const rec = order as Record<string, unknown>;
  const raw = identityField(
    rec,
    'motherCoil', 'motherCoilNo', 'displayCoilNo', 'coilNo', 'batchNumber',
  );
  const slit = normalizeSlit(order.slitId);
  const tokens = raw.split(/\s+/);
  const coil = slit && tokens[tokens.length - 1]?.toUpperCase() === slit
    ? tokens.slice(0, -1).join(' ')
    : raw;
  return [coil, slit, finishGroupOf(finishOf(order))].join('|');
}

export function isCompatibleCombinedRunOrder(base: OrderIdentitySource, candidate: OrderIdentitySource): boolean {
  return combinedRunKey(base) === combinedRunKey(candidate);
}

export function orderIdentitySubtitle(order: OrderIdentitySource): string {
  const batch = asDisplayText(order.batchNumber);
  return batch ? `Batch ${batch}` : '';
}
