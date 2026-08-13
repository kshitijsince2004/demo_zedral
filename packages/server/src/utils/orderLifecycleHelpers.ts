/**
 * Pure order-lifecycle helpers shared by Rolling (CRM) and Rewinding.
 * No DB / CRM state — side-effect-free.
 */

/** Finish-surface family: LOW_MATT ≡ MATT, MIRROR ≡ BRIGHT. */
export function finishGroup(value: string | null | undefined): string {
  const s = (value?.trim() || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (s === 'M' || s === 'MATTE' || s.includes('MATT')) return 'MATT';
  if (s === 'B' || s === 'BRIGHT' || s === 'MIRROR') return 'BRIGHT';
  return s;
}

export type CombineEligibilityInput = {
  machineCode: string | null | undefined;
  machineAllocated: boolean;
  coilNo: string;
  slitId?: string | null;
  rollFinish?: string | null;
  /** CRM-only; omit / ignore for rewinding. */
  subProcess?: string | null;
};

/**
 * Combine eligibility: same machine + allocated + Mother/Slit/Finish family.
 * Optionally require same subProcess (CRM rolling/skin-pass).
 */
export function assertCombineEligible(
  batches: CombineEligibilityInput[],
  opts?: { requireSameSubProcess?: boolean },
): void {
  if (batches.length === 0) throw new Error('At least one order is required');
  const first = batches[0];
  const normalized = (v: string | null | undefined) => v?.trim() || '';
  const baseKey = [first.coilNo, normalized(first.slitId), finishGroup(first.rollFinish)].join('|');

  for (const batch of batches) {
    if (!batch.machineAllocated) {
      throw new Error('Assign a production machine before starting');
    }
    if (batch.machineCode !== first.machineCode) {
      throw new Error('Combined production orders must be assigned to the same machine');
    }
    if (opts?.requireSameSubProcess && batch.subProcess !== first.subProcess) {
      throw new Error('Combined production orders must use the same subprocess');
    }
    const key = [batch.coilNo, normalized(batch.slitId), finishGroup(batch.rollFinish)].join('|');
    if (key !== baseKey) {
      throw new Error('Selected orders must share Mother Coil, Slit ID, and Finish surface');
    }
  }
}

export function combineRunKey(coilNo: string, slitId?: string | null, rollFinish?: string | null): string {
  return [coilNo, slitId?.trim() || '', finishGroup(rollFinish)].join('|');
}

/** After dissolving a PREPARING combined group: allocated stays PREPARING, else PENDING. */
export function statusAfterUngroupCombine(machineAllocated: boolean): 'PENDING' | 'PREPARING' {
  return machineAllocated ? 'PREPARING' : 'PENDING';
}

const ACTIVE_ORDER_CONFLICT_PREFIX = 'ACTIVE_ORDER_CONFLICT:';

/** Build / parse ACTIVE_ORDER_CONFLICT:<batch> (slice — batch numbers may contain colons). */
export function activeOrderConflictMessage(batchNumber: string): string {
  return `${ACTIVE_ORDER_CONFLICT_PREFIX}${batchNumber.trim()}`;
}

export function parseActiveOrderConflictBatch(message: string): string | undefined {
  if (!message.startsWith(ACTIVE_ORDER_CONFLICT_PREFIX)) return undefined;
  const batch = message.slice(ACTIVE_ORDER_CONFLICT_PREFIX.length).trim();
  return batch || undefined;
}

/** Net production minutes = elapsed − stoppage minutes (floor at 0). */
export function netProdDurationMin(
  startAt: Date,
  endAt: Date,
  stoppageMinutes: number,
): number {
  const elapsed = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));
  return Math.max(0, elapsed - Math.max(0, stoppageMinutes));
}

/** Heal orphan STOPPAGE when no open stoppage row remains. */
export function healOrphanStoppageStatus(args: {
  status: string;
  hasActiveStoppage: boolean;
  prodStartAt: Date | string | null | undefined;
  machineAllocated: boolean;
}): string {
  if (args.status !== 'STOPPAGE' || args.hasActiveStoppage) return args.status;
  if (args.prodStartAt) return 'IN_PROGRESS';
  return args.machineAllocated ? 'PREPARING' : 'PENDING';
}

export function assertCanAddStoppage(status: string): void {
  if (status !== 'IN_PROGRESS' && status !== 'STOPPAGE') {
    throw new Error('Stoppage can only be recorded while production is running');
  }
}

export function assertRejectPayload(rejectionReason: string, remarks: string): void {
  if (!rejectionReason?.trim()) throw new Error('Hold reason is required');
  if (!remarks?.trim()) throw new Error('Hold remarks are required');
}
