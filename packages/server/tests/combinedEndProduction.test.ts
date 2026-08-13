import { describe, expect, it } from 'vitest';
import { SixHiEndProductionSchema } from '@m1/shared-validation';
import {
  allocateCombinedRemainderToBlanks,
  resolveCombinedActualMt,
} from '@m1/shared-validation';
import {
  statusAfterUngroupCombine,
  parseActiveOrderConflictBatch,
  activeOrderConflictMessage,
} from '../src/utils/orderLifecycleHelpers';

describe('SixHiEndProductionSchema', () => {
  it('accepts optional combinedActualMt for combined ends', () => {
    const parsed = SixHiEndProductionSchema.safeParse({
      defectCodes: ['D1'],
      combinedActualMt: 10,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.combinedActualMt).toBe(10);
    }
  });

  it('rejects non-positive combinedActualMt', () => {
    const parsed = SixHiEndProductionSchema.safeParse({ combinedActualMt: 0 });
    expect(parsed.success).toBe(false);
  });
});

describe('combined end weight allocation contract', () => {
  it('preserves 5 + 5 entered weights (no re-allocation)', () => {
    expect(
      allocateCombinedRemainderToBlanks(
        [
          { batchNumber: 'A', actualWeightMt: 5 },
          { batchNumber: 'B', actualWeightMt: 5 },
        ],
        [
          { batchNumber: 'A', targetMt: 5 },
          { batchNumber: 'B', targetMt: 5 },
        ],
        10,
      ),
    ).toBeNull();
    expect(resolveCombinedActualMt([5, 5])).toBe(10);
  });

  it('fills blank sibling from explicit combined total', () => {
    const allocation = allocateCombinedRemainderToBlanks(
      [
        { batchNumber: 'A', actualWeightMt: 6 },
        { batchNumber: 'B', actualWeightMt: null },
      ],
      [
        { batchNumber: 'A', targetMt: 6 },
        { batchNumber: 'B', targetMt: 4 },
      ],
      10,
    );
    expect(allocation?.get('A')).toBeUndefined();
    expect(allocation?.get('B')).toBe(4);
  });
});

describe('cancel combined / ungroup', () => {
  it('statusAfterUngroupCombine keeps PREPARING when allocated', () => {
    expect(statusAfterUngroupCombine(true)).toBe('PREPARING');
    expect(statusAfterUngroupCombine(false)).toBe('PENDING');
  });

  it('parses ACTIVE_ORDER_CONFLICT batch without splitting on colons in the id', () => {
    expect(parseActiveOrderConflictBatch(activeOrderConflictMessage('C-PPC:1786'))).toBe('C-PPC:1786');
    expect(parseActiveOrderConflictBatch('ACTIVE_ORDER_CONFLICT:')).toBeUndefined();
    expect(parseActiveOrderConflictBatch('other')).toBeUndefined();
  });

  it('SixHiService.cancelCombinedProduction is exported', async () => {
    const { SixHiService } = await import('../src/services/SixHiService');
    expect(typeof SixHiService.cancelCombinedProduction).toBe('function');
    expect(SixHiService.cancelCombinedProduction.length).toBeGreaterThanOrEqual(1);
  });

  it('RewindingOrderService.cancelCombinedProduction is exported', async () => {
    const { RewindingOrderService } = await import('../src/services/RewindingOrderService');
    expect(typeof RewindingOrderService.cancelCombinedProduction).toBe('function');
  });
});

describe('SixHiService.endProduction', () => {
  it('is exported with combinedActualMt parameter support', async () => {
    const { SixHiService } = await import('../src/services/SixHiService');
    expect(SixHiService.endProduction.length).toBeGreaterThanOrEqual(3);
  });
});
