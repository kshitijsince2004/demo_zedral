import { describe, it, expect } from 'vitest';
import { isPklMhDesk } from '../src/lib/pklMhDesk';
import {
  findPklSiblingCoils,
  pklGroupWeightMt,
  pklSiblingKey,
  parsePklCoilIdentity,
} from '../src/lib/pklSiblingSelect';
import type { ProcessQueueCard } from '../src/store/processStore';

function card(partial: Partial<ProcessQueueCard> & Pick<ProcessQueueCard, 'coilNo'>): ProcessQueueCard {
  return {
    gradeCode: 'D',
    customerName: 'X',
    widthMm: 1000,
    thicknessMm: 2,
    weightMt: 5,
    status: 'PENDING',
    journeyId: '1',
    stepNo: 1,
    ...partial,
  };
}

describe('isPklMhDesk', () => {
  it('true when focus is PKL', () => {
    expect(isPklMhDesk(['6HI', 'PKL'], 'PKL')).toBe(true);
  });

  it('true when sole operational machine is PKL', () => {
    expect(isPklMhDesk(['PKL'], null)).toBe(true);
  });

  it('false for multi-machine without PKL focus', () => {
    expect(isPklMhDesk(['6HI', 'PKL'], null)).toBe(false);
    expect(isPklMhDesk(['6HI'], '6HI')).toBe(false);
  });
});

describe('pklSiblingSelect', () => {
  it('parses mother-slit identity', () => {
    expect(parsePklCoilIdentity('1100038398-G')).toEqual({ motherCoilNo: '1100038398', slitId: 'G' });
    expect(parsePklCoilIdentity('1100038398')).toEqual({ motherCoilNo: '1100038398', slitId: null });
  });

  it('groups by mother+slit+grade', () => {
    const a = card({ coilNo: 'M1-A', gradeCode: 'D', motherCoilNo: 'M1', slitId: 'A', weightMt: 10 });
    const b = card({ coilNo: 'OTHER', gradeCode: 'D', motherCoilNo: 'M1', slitId: 'A', weightMt: 7 });
    const c = card({ coilNo: 'M1-B', gradeCode: 'D', motherCoilNo: 'M1', slitId: 'B', weightMt: 3 });
    const d = card({ coilNo: 'M1-A2', gradeCode: 'PT', motherCoilNo: 'M1', slitId: 'A', weightMt: 4 });
    expect(pklSiblingKey(a)).toBe(pklSiblingKey(b));
    const sibs = findPklSiblingCoils(a, [a, b, c, d]);
    expect(sibs.map((s) => s.coilNo).sort()).toEqual(['M1-A', 'OTHER']);
    expect(pklGroupWeightMt(sibs)).toBe(17);
  });

  it('keeps C1-A and C1-A2 together when both cards say slit A', () => {
    const a = card({ coilNo: 'C1-A', motherCoilNo: 'C1', slitId: 'A', gradeCode: 'G1' });
    const a2 = card({ coilNo: 'C1-A2', motherCoilNo: 'C1', slitId: 'A', gradeCode: 'G1' });
    expect(pklSiblingKey(a)).toBe(pklSiblingKey(a2));
    expect(findPklSiblingCoils(a, [a, a2]).map((s) => s.coilNo).sort()).toEqual(['C1-A', 'C1-A2']);
  });

  it('buckets a -C child with C siblings even when card.slitId is B', () => {
    const divergent = card({ coilNo: '110038829-C', slitId: 'B', gradeCode: 'D' });
    const siblingC = card({ coilNo: 'X', motherCoilNo: '110038829', slitId: 'C', gradeCode: 'D' });
    const slotB = card({ coilNo: '110038829-B', slitId: 'B', gradeCode: 'D' });
    expect(pklSiblingKey(divergent)).toBe(pklSiblingKey(siblingC));
    expect(pklSiblingKey(divergent)).not.toBe(pklSiblingKey(slotB));
    const sibs = findPklSiblingCoils(divergent, [divergent, siblingC, slotB]);
    expect(sibs.map((s) => s.coilNo).sort()).toEqual(['110038829-C', 'X']);
  });

  it('ignores HOLD/COMPLETED for grouping', () => {
    const a = card({ coilNo: 'M1-A', motherCoilNo: 'M1', slitId: 'A', status: 'PENDING' });
    const hold = card({ coilNo: 'M1-A2', motherCoilNo: 'M1', slitId: 'A', status: 'HOLD' });
    expect(findPklSiblingCoils(a, [a, hold])).toEqual([a]);
  });
});
