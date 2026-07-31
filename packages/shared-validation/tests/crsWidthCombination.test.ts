import { describe, it, expect } from 'vitest';
import { crsWidthCombinationWarn } from '../src/utils/crsWidthCombination';

describe('crsWidthCombinationWarn', () => {
  it('ok when packed widths fit input', () => {
    const r = crsWidthCombinationWarn(1000, [
      { finishWidthMm: 200, noOfSlit: 2 },
      { finishWidthMm: 400, noOfSlit: 1 },
    ], 50);
    expect(r.ok).toBe(true);
    expect(r.packedMm).toBe(850);
  });

  it('warns when packed exceeds input', () => {
    const r = crsWidthCombinationWarn(500, [
      { finishWidthMm: 300, noOfSlit: 2 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/exceeds/);
  });
});
