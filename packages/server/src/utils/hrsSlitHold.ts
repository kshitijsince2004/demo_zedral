import { derivedChildCoilNo } from './childCoil';

export function requireHrsSlitId(raw?: string | null): string {
  const slitId = String(raw ?? '').trim();
  if (!slitId) throw new Error('slitId is required');
  return slitId;
}

export function normalizeHrsSlot(slot: string): string {
  return slot.trim().toUpperCase();
}

export function matchHrsSlitLine<T extends { slitId?: string; batchNumber?: string }>(
  lines: T[],
  slitId: string,
  batchNumber?: string,
): T | undefined {
  const id = normalizeHrsSlot(slitId);
  const batch = batchNumber?.trim();
  if (batch) {
    const both = lines.find(
      (l) => normalizeHrsSlot(l.slitId ?? '') === id && (l.batchNumber ?? '') === batch,
    );
    if (both) return both;
  }
  return lines.find((l) => normalizeHrsSlot(l.slitId ?? '') === id);
}

export function allPlanSlitsHeld(
  lines: Array<{ slitId?: string }>,
  heldSlots: Iterable<string>,
): boolean {
  const held = new Set([...heldSlots].map(normalizeHrsSlot));
  const slots = lines.map((l) => normalizeHrsSlot(l.slitId ?? '')).filter(Boolean);
  return slots.length > 0 && slots.every((s) => held.has(s));
}

export type HrsFanOutLine = {
  slitId?: string;
  batchNumber?: string;
  widthMm?: number;
  weightMt?: number;
  thicknessMm?: number;
  customerName?: string;
  routeRaw?: string;
};

export type HrsFanOutMother = {
  coilNo: string;
  gradeCode: string;
  customerName: string;
  widthMm: number;
  thicknessMm: number;
  weightMt: number;
  status: string;
  journeyId?: string;
  stepNo?: number;
};

export type HrsFanOutCard = HrsFanOutMother & {
  displayCoilNo?: string;
  slitId?: string;
  batchNumber?: string;
  orderLines?: HrsFanOutLine[];
  lineCount?: number;
  combination?: string;
  routeRaw?: string;
};

const MILL_LIVE = new Set(['PENDING', 'PREPARING', 'IN_PROGRESS', 'STOPPAGE']);

function combinationOf(lines: HrsFanOutLine[]): string | undefined {
  if (!lines.length) return undefined;
  return lines.map((ol) => (ol.widthMm != null ? String(ol.widthMm) : '?')).join('+');
}

function millCard(mother: HrsFanOutMother, lines: HrsFanOutLine[]): HrsFanOutCard {
  return {
    ...mother,
    orderLines: lines,
    lineCount: Math.max(1, lines.length),
    combination: combinationOf(lines),
    routeRaw: lines.find((ol) => ol.routeRaw)?.routeRaw,
  };
}

function slitCard(
  mother: HrsFanOutMother,
  line: HrsFanOutLine,
  status: string,
  kind: 'hold' | 'done',
): HrsFanOutCard {
  const slot = normalizeHrsSlot(line.slitId ?? '');
  const child = slot ? derivedChildCoilNo(mother.coilNo, slot) : mother.coilNo;
  return {
    coilNo: mother.coilNo,
    displayCoilNo: child,
    gradeCode: mother.gradeCode,
    customerName: line.customerName ?? mother.customerName,
    widthMm: line.widthMm ?? mother.widthMm,
    thicknessMm: line.thicknessMm ?? mother.thicknessMm,
    weightMt: line.weightMt ?? mother.weightMt,
    status,
    journeyId: `${kind}:${mother.coilNo}:${slot || 'x'}`,
    stepNo: mother.stepNo,
    slitId: line.slitId,
    batchNumber: line.batchNumber,
    orderLines: [line],
    lineCount: 1,
    combination: combinationOf([line]),
    routeRaw: line.routeRaw,
  };
}

/** Queue cards: one mill session + per-slit HOLD / COMPLETED. */
export function fanOutHrsQueueCards(
  mother: HrsFanOutMother,
  lines: HrsFanOutLine[],
  heldSlots: Array<{ slitId: string; batchNumber?: string }>,
): HrsFanOutCard[] {
  const held = new Set(heldSlots.map((h) => normalizeHrsSlot(h.slitId)));
  const status = mother.status.toUpperCase();

  if (MILL_LIVE.has(status)) {
    const cards = [millCard(mother, lines)];
    for (const line of lines) {
      const slot = normalizeHrsSlot(line.slitId ?? '');
      if (!slot || !held.has(slot)) continue;
      cards.push(slitCard(mother, line, 'REJECTED', 'hold'));
    }
    return cards;
  }

  if (status === 'COMPLETED' || status === 'REJECTED') {
    if (!lines.length) return [millCard(mother, lines)];
    return lines.map((line) => {
      const slot = normalizeHrsSlot(line.slitId ?? '');
      const isHeld = (slot && held.has(slot)) || status === 'REJECTED';
      return slitCard(mother, line, isHeld ? 'REJECTED' : 'COMPLETED', isHeld ? 'hold' : 'done');
    });
  }

  return [millCard(mother, lines)];
}
