/** Minimal shape shared by ProcessHub cards and RewindingQueueCard. */
export type RwdCombineable = {
  batchNumber?: string;
  coilNo: string;
  slitId?: string;
  surfaceFinish?: string;
  status?: string;
  combinedGroupId?: string;
  weightMt: number;
  prefill?: Record<string, unknown>;
};

/** Finish-surface family — must match server `finishGroup` / `assertCombineEligible`. */
export function rwdFinishGroup(value: string | null | undefined): string {
  const s = (value?.trim() || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (s === 'M' || s === 'MATTE' || s.includes('MATT')) return 'MATT';
  if (s === 'B' || s === 'BRIGHT' || s === 'MIRROR') return 'BRIGHT';
  return s;
}

function prefVal(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    const v = (raw as { value: unknown }).value;
    if (v == null || v === '') return undefined;
    return String(v);
  }
  return String(raw);
}

/** Compatibility key: mother coil + slit + finish (same as server combineRunKey). */
export function rwdCombineKey(card: RwdCombineable): string {
  const finish = card.surfaceFinish ?? prefVal(card.prefill?.surfaceFinish) ?? '';
  return [
    (card.coilNo || '').trim(),
    (card.slitId ?? '').trim(),
    rwdFinishGroup(finish),
  ].join('|');
}

/** Status buckets that may auto-combine (mirrors 6HI COMBINE_STATUS_GROUPS). */
const RWD_COMBINE_GROUPS: string[][] = [
  ['PENDING', 'PREPARING'],
  ['IN_PROGRESS', 'STOPPAGE'],
  ['COMPLETED'],
  ['REJECTED', 'HOLD'],
];

const STATUS_TO_GROUP = new Map(
  RWD_COMBINE_GROUPS.flatMap((statuses, i) => statuses.map((s) => [s, i] as const)),
);

export function rwdCombineStatusGroup(status?: string): number | null {
  const raw = (status ?? 'PENDING').toUpperCase();
  return STATUS_TO_GROUP.get(raw) ?? null;
}

/** Anchor + siblings: same combined_group_id, or same Mother/Slit/Finish in the same status bucket. */
export function findRwdCompatibleOrders<T extends RwdCombineable>(
  anchor: T,
  queue: T[],
): T[] {
  if (!anchor.batchNumber) return [anchor];

  if (anchor.combinedGroupId) {
    const byGroup = queue.filter(
      (c) => c.combinedGroupId === anchor.combinedGroupId && c.batchNumber,
    );
    if (byGroup.length > 1) return byGroup;
  }

  const group = rwdCombineStatusGroup(anchor.status);
  if (group == null) return [anchor];

  const key = rwdCombineKey(anchor);
  const matches = queue.filter(
    (c) =>
      !!c.batchNumber
      && rwdCombineStatusGroup(c.status) === group
      && rwdCombineKey(c) === key,
  );
  return matches.length > 0 ? matches : [anchor];
}

export function rwdGroupWeightMt(cards: Array<{ weightMt: number }>): number {
  return cards.reduce((sum, c) => sum + (Number(c.weightMt) || 0), 0);
}

export function rwdCombinedActionLabel(cards: Array<{ status?: string }>): string {
  if (cards.length <= 1) return 'Move to Production…';
  const group = rwdCombineStatusGroup(cards[0]?.status);
  if (group === 0) return `Move Combined to Preparing (${cards.length})`;
  if (group === 2 || group === 3) return `View Combined (${cards.length})`;
  return `Open Combined (${cards.length})`;
}
