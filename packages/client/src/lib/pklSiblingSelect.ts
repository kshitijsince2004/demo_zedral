import type { ProcessQueueCard } from '../store/processStore';

/** Split mother-slit display ids (same rule as server parseCoilIdentity). */
export function parsePklCoilIdentity(coilNo: string): { motherCoilNo: string; slitId: string | null } {
  const m = String(coilNo).trim().match(/^(.+)-([A-Za-z0-9]{1,4})$/);
  if (m) return { motherCoilNo: m[1], slitId: m[2] };
  return { motherCoilNo: String(coilNo).trim(), slitId: null };
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

/** Compatibility key: motherCoilNo + slitId + gradeCode (Option A). */
export function pklSiblingKey(card: ProcessQueueCard): string {
  const p = card.prefill ?? {};
  const parsed = parsePklCoilIdentity(card.coilNo);
  const mother = (
    card.motherCoilNo
    ?? prefVal(p.motherCoilNo)
    ?? prefVal(p.parentCoilNo)
    ?? parsed.motherCoilNo
  ).trim().toUpperCase();
  // ponytail: one-letter suffix is the plant slit (`110038829-C`); longer tokens (`C1-A2`) keep card.slitId
  const letterSuffix = parsed.slitId && /^[A-Za-z]$/.test(parsed.slitId) ? parsed.slitId : null;
  const slit = (
    letterSuffix
    ?? card.slitId
    ?? prefVal(p.slitId)
    ?? parsed.slitId
    ?? ''
  ).trim().toUpperCase();
  const grade = (card.gradeCode || '').trim().toUpperCase();
  return `${mother}|${slit}|${grade}`;
}

const RUN_STATUSES = new Set(['PENDING', 'IN_PROGRESS']);

/** Anchor + siblings sharing mother+slit+grade in the same run bucket. */
export function findPklSiblingCoils(
  anchor: ProcessQueueCard,
  queue: ProcessQueueCard[],
): ProcessQueueCard[] {
  if (!RUN_STATUSES.has(anchor.status)) return [anchor];
  const key = pklSiblingKey(anchor);
  const matches = queue.filter(
    (c) => RUN_STATUSES.has(c.status) && pklSiblingKey(c) === key,
  );
  return matches.length > 0 ? matches : [anchor];
}

export function pklGroupWeightMt(cards: ProcessQueueCard[]): number {
  return cards.reduce((sum, c) => sum + (Number(c.weightMt) || 0), 0);
}
