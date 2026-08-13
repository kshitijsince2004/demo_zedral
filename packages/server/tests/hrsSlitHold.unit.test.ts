import { describe, expect, it } from 'vitest';
import {
  allPlanSlitsHeld,
  fanOutHrsQueueCards,
  matchHrsSlitLine,
  requireHrsSlitId,
} from '../src/utils/hrsSlitHold';

const lines = [
  { slitId: 'A', batchNumber: 'B1', widthMm: 300, weightMt: 5 },
  { slitId: 'B', batchNumber: 'B2', widthMm: 310, weightMt: 6 },
  { slitId: 'C', batchNumber: 'B3', widthMm: 320, weightMt: 7 },
];

const mother = {
  coilNo: '1100038447',
  gradeCode: 'CRCA',
  customerName: 'Acme',
  widthMm: 1000,
  thicknessMm: 2,
  weightMt: 18,
  status: 'IN_PROGRESS',
  journeyId: 'j1',
  stepNo: 1,
};

describe('hrsSlitHold', () => {
  it('requireHrsSlitId rejects missing slit', () => {
    expect(() => requireHrsSlitId('')).toThrow(/slitId is required/);
    expect(() => requireHrsSlitId(undefined)).toThrow(/slitId is required/);
    expect(requireHrsSlitId(' a ')).toBe('a');
  });

  it('matchHrsSlitLine prefers slit+batch then slit', () => {
    expect(matchHrsSlitLine(lines, 'a', 'B1')?.batchNumber).toBe('B1');
    expect(matchHrsSlitLine(lines, 'B')?.slitId).toBe('B');
    expect(matchHrsSlitLine(lines, 'Z')).toBeUndefined();
  });

  it('allPlanSlitsHeld is false until every plan slot is held', () => {
    expect(allPlanSlitsHeld(lines, ['A'])).toBe(false);
    expect(allPlanSlitsHeld(lines, ['A', 'B', 'C'])).toBe(true);
    expect(allPlanSlitsHeld([], ['A'])).toBe(false);
  });

  it('hold slit A of A/B/C: mill stays live; only A is a HOLD card', () => {
    const cards = fanOutHrsQueueCards(mother, lines, [{ slitId: 'A', batchNumber: 'B1' }]);
    expect(cards.map((c) => `${c.status}:${c.slitId ?? 'mill'}`)).toEqual([
      'IN_PROGRESS:mill',
      'REJECTED:A',
    ]);
    expect(cards[0].coilNo).toBe('1100038447');
    expect(cards[1].displayCoilNo).toBe('1100038447-A');
    expect(cards.some((c) => c.slitId === 'B' && c.status === 'REJECTED')).toBe(false);
  });

  it('end mother: B/C COMPLETED cards; A stays on Order Hold', () => {
    const cards = fanOutHrsQueueCards(
      { ...mother, status: 'COMPLETED' },
      lines,
      [{ slitId: 'A' }],
    );
    expect(cards.find((c) => c.slitId === 'A')?.status).toBe('REJECTED');
    expect(cards.find((c) => c.slitId === 'B')?.status).toBe('COMPLETED');
    expect(cards.find((c) => c.slitId === 'C')?.status).toBe('COMPLETED');
    expect(cards.some((c) => !c.slitId)).toBe(false);
  });

  it('HrsOrderService.rejectOrder without slitId throws before DB', async () => {
    const { HrsOrderService } = await import('../src/services/HrsOrderService');
    await expect(HrsOrderService.rejectOrder('x', 'HOLD', 'notes', 1)).rejects.toThrow(/slitId is required/);
  });

  it('reinstate A only: completed mother fans B/C done and A proceeds as COMPLETED', () => {
    const cards = fanOutHrsQueueCards(
      { ...mother, status: 'COMPLETED' },
      lines,
      [],
    );
    expect(cards.every((c) => c.status === 'COMPLETED')).toBe(true);
    expect(cards.map((c) => c.slitId)).toEqual(['A', 'B', 'C']);
  });
});
