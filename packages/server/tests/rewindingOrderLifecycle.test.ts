import { describe, it, expect } from 'vitest';
import {
  assertCombineEligible,
  combineRunKey,
  finishGroup,
  netProdDurationMin,
} from '../src/utils/orderLifecycleHelpers';
import {
  assertRewindingMachine,
  parseRewindingMachineCode,
  REWINDING_MACHINES,
} from '../src/utils/rewindingMachines';

describe('orderLifecycleHelpers', () => {
  it('finishGroup collapses matt/bright families', () => {
    expect(finishGroup('LOW_MATT')).toBe('MATT');
    expect(finishGroup('MIRROR')).toBe('BRIGHT');
    expect(finishGroup('BRIGHT')).toBe('BRIGHT');
  });

  it('assertCombineEligible requires same machine + mother/slit/finish', () => {
    expect(() =>
      assertCombineEligible([
        { machineCode: 'RWD', machineAllocated: true, coilNo: 'C1', slitId: 'A', rollFinish: 'MATT' },
        { machineCode: 'RWD', machineAllocated: true, coilNo: 'C1', slitId: 'A', rollFinish: 'LOW_MATT' },
      ]),
    ).not.toThrow();

    expect(() =>
      assertCombineEligible([
        { machineCode: 'RWD', machineAllocated: true, coilNo: 'C1', slitId: 'A', rollFinish: 'MATT' },
        { machineCode: '2HI', machineAllocated: true, coilNo: 'C1', slitId: 'A', rollFinish: 'MATT' },
      ]),
    ).toThrow(/same machine/);

    expect(() =>
      assertCombineEligible([
        { machineCode: 'RWD', machineAllocated: false, coilNo: 'C1', slitId: 'A', rollFinish: 'MATT' },
      ]),
    ).toThrow(/Assign a production machine/);
  });

  it('combineRunKey is stable', () => {
    expect(combineRunKey('C1', 'S1', 'MATT')).toBe(combineRunKey('C1', 'S1', 'LOW_MATT'));
  });

  it('netProdDurationMin subtracts stoppage', () => {
    const start = new Date('2026-08-02T10:00:00Z');
    const end = new Date('2026-08-02T11:00:00Z');
    expect(netProdDurationMin(start, end, 15)).toBe(45);
    expect(netProdDurationMin(start, end, 90)).toBe(0);
  });
});

describe('rewindingMachines', () => {
  it('pool is RWD|2HI', () => {
    expect([...REWINDING_MACHINES]).toEqual(['RWD', '2HI']);
  });

  it('parse/assert', () => {
    expect(parseRewindingMachineCode('rwd')).toBe('RWD');
    expect(parseRewindingMachineCode('6HI')).toBeNull();
    expect(assertRewindingMachine('2HI')).toBe('2HI');
    expect(() => assertRewindingMachine('6HI')).toThrow(/Invalid rewinding machine/);
  });
});
