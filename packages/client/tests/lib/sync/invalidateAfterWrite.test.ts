import { describe, expect, it, vi } from 'vitest';
import {
  invalidateAfterSyncedWrite,
  invalidateAfterWrite,
  shouldInvalidateCachesForUrl,
} from '../../../src/lib/sync/invalidateAfterWrite';

vi.mock('../../../src/lib/productionSync', () => ({
  notifyProductionChanged: vi.fn(),
}));

import { notifyProductionChanged } from '../../../src/lib/productionSync';

describe('invalidateAfterWrite', () => {
  it('matches production-related API paths', () => {
    expect(shouldInvalidateCachesForUrl('/6hi/orders/B1/start')).toBe(true);
    expect(shouldInvalidateCachesForUrl('/production/hrs')).toBe(true);
    expect(shouldInvalidateCachesForUrl('/machines/handover/overview')).toBe(true);
    expect(shouldInvalidateCachesForUrl('/rewinding/orders/B1/capture')).toBe(true);
    expect(shouldInvalidateCachesForUrl('/stations/pkl/chart')).toBe(true);
    expect(shouldInvalidateCachesForUrl('/auth/badge-pin')).toBe(false);
    expect(shouldInvalidateCachesForUrl('/exports')).toBe(false);
  });

  it('dispatches production sync event on write', () => {
    invalidateAfterWrite({ batchNumber: 'B1' });
    expect(notifyProductionChanged).toHaveBeenCalledWith({ batchNumber: 'B1' });
  });

  it('dispatches only for cache-relevant replay URLs', () => {
    vi.mocked(notifyProductionChanged).mockClear();
    invalidateAfterSyncedWrite('/6hi/orders/B1/end');
    invalidateAfterSyncedWrite('/exports');
    expect(notifyProductionChanged).toHaveBeenCalledTimes(1);
  });
});