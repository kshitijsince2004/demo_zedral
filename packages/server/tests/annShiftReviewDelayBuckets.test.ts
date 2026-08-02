import { describe, it, expect } from 'vitest';
import {
  aggregateAnnDelayBuckets,
  ANN_DELAY_ORDER,
  mapAnnCrewRoles,
  normalizeAnnDelayBucket,
} from '../src/lib/annShiftReviewAgg';

describe('annShiftReviewAgg delay buckets', () => {
  it('normalizes category fallback and unknown → OPN', () => {
    expect(normalizeAnnDelayBucket(null, 'POWER')).toBe('POWER FAILURE');
    expect(normalizeAnnDelayBucket('MECH', 'POWER')).toBe('MECH');
    expect(normalizeAnnDelayBucket('NOPE', 'X')).toBe('OPN');
  });

  it('always emits five buckets and totalDelayMin = sum', () => {
    const { delaySummary, totalDelayMin } = aggregateAnnDelayBuckets([
      { category_code: 'BASE_FAN', duration_min: 10 },
      { delay_bucket: 'POWER FAILURE', duration_min: 5 },
      { category_code: 'CRANE', duration_min: 2 },
    ]);
    expect(delaySummary.map((d) => d.bucket)).toEqual([...ANN_DELAY_ORDER]);
    expect(delaySummary.find((d) => d.bucket === 'MECH')?.minutes).toBe(10);
    expect(delaySummary.find((d) => d.bucket === 'POWER FAILURE')?.minutes).toBe(5);
    expect(delaySummary.find((d) => d.bucket === 'OPN')?.minutes).toBe(2);
    expect(totalDelayMin).toBe(17);
  });
});

describe('annShiftReviewAgg crew roles', () => {
  it('maps role labels to the four ANN rows', () => {
    const crew = mapAnnCrewRoles([
      { operatorName: 'Asha', roleCode: 'OPERATOR' },
      { operatorName: 'Ravi', roleCode: 'HELPER' },
      { operatorName: 'Kiran', roleCode: 'CRANE OP' },
      { operatorName: 'Meera', roleCode: 'SHIFT INCHARGE' },
    ]);
    expect(crew.operatorEngineer).toBe('Asha');
    expect(crew.helper).toBe('Ravi');
    expect(crew.craneOperator).toBe('Kiran');
    expect(crew.shiftIncharge).toBe('Meera');
    expect(crew.signature).toBe('—');
  });
});
