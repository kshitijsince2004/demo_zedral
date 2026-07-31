import { describe, it, expect } from 'vitest';
import { annBatchingAdvisories } from '../src/lib/annBatchingAdvisories';

describe('annBatchingAdvisories', () => {
  it('warns when coils exceed base capacity', () => {
    const w = annBatchingAdvisories({
      coilCount: 13,
      weightMt: 10,
      base: { base_no: 'AB01', capacity_max_coils: 12, capacity_max_wt_mt: 40 },
      limits: [],
    });
    expect(w.some((m) => m.includes('13 coils'))).toBe(true);
  });

  it('warns on weight and adds clubbing note for multi-coil', () => {
    const w = annBatchingAdvisories({
      coilCount: 2,
      weightMt: 45,
      base: { base_no: 'AB02', capacity_max_coils: 12, capacity_max_wt_mt: 40 },
      limits: [{ param_key: 'clubbing_soak_spread', scope: 'ALL', min_val: 10, max_val: 30, unit: 'C' }],
    });
    expect(w.some((m) => m.includes('45.00 MT'))).toBe(true);
    expect(w.some((m) => m.includes('Clubbing'))).toBe(true);
  });
});
