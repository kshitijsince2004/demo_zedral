import { describe, expect, it } from 'vitest';
import {
  importPathForLine,
  resolveImportableAssignedLines,
  resolveMhDesk,
} from '../src/lib/mhDesk';
import { siblingSelect } from '../src/lib/siblingSelect';
import type { ProcessQueueCard } from '../src/store/processStore';

describe('resolveMhDesk (ANN wins)', () => {
  it('prefers ANN over other assigned lines', () => {
    expect(resolveMhDesk(['ANN', 'HRS'], 'ANN')).toBe('ann');
    expect(resolveMhDesk(['ANN'], null)).toBe('ann');
  });

  it('prefers RWD over HRS/PKL when focused', () => {
    expect(resolveMhDesk(['RWD', 'HRS'], 'RWD')).toBe('rwd');
    expect(resolveMhDesk(['RWD'], null)).toBe('rwd');
  });

  it('resolves HRS/PKL desks', () => {
    expect(resolveMhDesk(['HRS'], null)).toBe('hrs');
    expect(resolveMhDesk(['PKL'], null)).toBe('pkl');
    expect(resolveMhDesk(['HRS', 'PKL'], 'HRS')).toBe('hrs_pkl');
  });
});

describe('resolveImportableAssignedLines (F4 mixed desk)', () => {
  it('MH with HRS + CRM still yields HRS import path', () => {
    const lines = resolveImportableAssignedLines(['HRS', '6HI']);
    expect(lines).toEqual(['HRS']);
    expect(importPathForLine(lines[0]!)).toBe('/machine-head/hrs/import');
  });

  it('lists every importable line independently of desk focus', () => {
    expect(resolveImportableAssignedLines(['HRS', 'PKL', 'ANN', 'RWD', '6HI'])).toEqual([
      'HRS', 'PKL', 'ANN', 'RWD',
    ]);
  });

  it('returns empty when only CRM mills assigned', () => {
    expect(resolveImportableAssignedLines(['6HI', '4HI'])).toEqual([]);
  });
});

describe('siblingSelect', () => {
  const base = (over: Partial<ProcessQueueCard>): ProcessQueueCard => ({
    coilNo: 'C1-A',
    motherCoilNo: 'C1',
    slitId: 'A',
    gradeCode: 'G1',
    customerName: 'Cust',
    widthMm: 1000,
    thicknessMm: 2,
    weightMt: 1,
    status: 'PENDING',
    journeyId: 'j1',
    stepNo: 1,
    ...over,
  });

  it('groups PKL siblings by mother|slit|grade', () => {
    const a = base({});
    const b = base({ coilNo: 'C1-A2', weightMt: 2 });
    const other = base({ coilNo: 'C2-A', motherCoilNo: 'C2', gradeCode: 'G2' });
    const found = siblingSelect('PKL', a, [a, b, other]);
    expect(found.map((c) => c.coilNo).sort()).toEqual(['C1-A', 'C1-A2']);
  });
});
