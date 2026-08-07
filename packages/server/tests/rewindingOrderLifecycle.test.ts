import { describe, it, expect } from 'vitest';
import {
  allocateCombinedRemainderToBlanks,
} from '@m1/shared-validation';
import {
  assertCanAddStoppage,
  assertCombineEligible,
  assertRejectPayload,
  combineRunKey,
  finishGroup,
  healOrphanStoppageStatus,
  netProdDurationMin,
} from '../src/utils/orderLifecycleHelpers';
import {
  assertRewindingMachine,
  isRewindingPpcBatch,
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

describe('RewindingOrderService lifecycle rules', () => {
  it('healOrphanStoppageStatus prefers IN_PROGRESS when started', () => {
    expect(healOrphanStoppageStatus({
      status: 'STOPPAGE',
      hasActiveStoppage: false,
      prodStartAt: new Date(),
      machineAllocated: true,
    })).toBe('IN_PROGRESS');
  });

  it('healOrphanStoppageStatus prefers PREPARING when allocated but never started', () => {
    expect(healOrphanStoppageStatus({
      status: 'STOPPAGE',
      hasActiveStoppage: false,
      prodStartAt: null,
      machineAllocated: true,
    })).toBe('PREPARING');
  });

  it('healOrphanStoppageStatus falls to PENDING when unallocated', () => {
    expect(healOrphanStoppageStatus({
      status: 'STOPPAGE',
      hasActiveStoppage: false,
      prodStartAt: null,
      machineAllocated: false,
    })).toBe('PENDING');
  });

  it('healOrphanStoppageStatus no-ops when open stoppage exists', () => {
    expect(healOrphanStoppageStatus({
      status: 'STOPPAGE',
      hasActiveStoppage: true,
      prodStartAt: new Date(),
      machineAllocated: true,
    })).toBe('STOPPAGE');
  });

  it('assertCanAddStoppage only allows running/stoppage', () => {
    expect(() => assertCanAddStoppage('IN_PROGRESS')).not.toThrow();
    expect(() => assertCanAddStoppage('STOPPAGE')).not.toThrow();
    expect(() => assertCanAddStoppage('PENDING')).toThrow(/Stoppage can only/);
    expect(() => assertCanAddStoppage('COMPLETED')).toThrow(/Stoppage can only/);
  });

  it('assertRejectPayload requires reason + remarks (hold cascade gate)', () => {
    expect(() => assertRejectPayload('', 'notes')).toThrow(/Hold reason/);
    expect(() => assertRejectPayload('QUALITY', '')).toThrow(/Hold remarks/);
    expect(() => assertRejectPayload('QUALITY', 'held for defect')).not.toThrow();
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

describe('isRewindingPpcBatch', () => {
  it('accepts rewinding import/manual rows on RWD or 2HI only', () => {
    expect(isRewindingPpcBatch({ machine_code: 'RWD', sub_process: 'RWD', destination: 'REWINDING' })).toBe(true);
    expect(isRewindingPpcBatch({ machine_code: '2HI', sub_process: 'REWINDING' })).toBe(true);
    expect(isRewindingPpcBatch({ machine_code: 'RWD', sub_process: 'RWD' })).toBe(true);
    expect(isRewindingPpcBatch({ machine_code: '6HI', sub_process: 'ROLLING', destination: 'REWINDING' })).toBe(false);
    expect(isRewindingPpcBatch({ machine_code: '6HI', sub_process: 'ROLLING', from_work_center: 'R' })).toBe(false);
    expect(isRewindingPpcBatch({ machine_code: 'RWD', sub_process: 'ROLLING' })).toBe(false);
  });
});

describe('RWD combined capture weight split (G1)', () => {
  it('splits combined total across blank siblings by plan targets', () => {
    const allocation = allocateCombinedRemainderToBlanks(
      [
        { batchNumber: 'A', actualWeightMt: null },
        { batchNumber: 'B', actualWeightMt: null },
      ],
      [
        { batchNumber: 'A', targetMt: 2 },
        { batchNumber: 'B', targetMt: 3 },
      ],
      5,
    );
    expect(allocation?.get('A')).toBe(2);
    expect(allocation?.get('B')).toBe(3);
  });
});
