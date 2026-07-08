import { describe, expect, it } from 'vitest';
import { getEndProductionMissingFields } from '../src/rules/sixHiRules';

describe('getEndProductionMissingFields', () => {
  it('requires rolling weight, passes, and destination', () => {
    const missing = getEndProductionMissingFields({
      subProcess: 'ROLLING',
      rolling: { actualWeightMt: null, destination: null, passes: [] },
    });
    expect(missing).toEqual([
      'Actual Weight (MT)',
      'Pass Data (Thickness)',
      'Destination (Annealing/Rewinding)',
    ]);
  });

  it('requires skin pass weight and output thickness', () => {
    const missing = getEndProductionMissingFields({
      subProcess: 'SKIN_PASS',
      skinPass: { actualWeightMt: null, outputThkMm: null },
    });
    expect(missing).toEqual([
      'Actual Weight (MT)',
      'Output Thickness (mm)',
    ]);
  });

  it('returns no missing fields when rolling data is complete', () => {
    const missing = getEndProductionMissingFields({
      subProcess: 'ROLLING',
      rolling: {
        actualWeightMt: 1.2,
        destination: 'ANNEALING',
        passes: [{ passNo: 1, thicknessMm: 0.8 }],
      },
    });
    expect(missing).toEqual([]);
  });
});
