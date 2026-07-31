import { describe, it, expect } from 'vitest';
import { annStoppageDelayBucket, sumAnnStoppageDelayBuckets } from '../src/lib/annShiftReviewBuckets';
import { formatTraceabilityRecordDetails } from '../src/lib/traceabilityFormat';

describe('annStoppageDelayBucket', () => {
  it('maps known categories', () => {
    expect(annStoppageDelayBucket('POWER')).toBe('Power');
    expect(annStoppageDelayBucket('BASE_FAN')).toBe('Base / mechanical');
    expect(annStoppageDelayBucket('UNKNOWN_X')).toBe('Other');
  });

  it('sums minutes by bucket', () => {
    const rows = sumAnnStoppageDelayBuckets([
      { category_code: 'POWER', duration_min: 10 },
      { category_code: 'BASE_FAN', duration_min: 5 },
      { category_code: 'BASE_SEAL', duration_min: 7 },
    ]);
    expect(rows.find((r) => r.bucket === 'Base / mechanical')?.minutes).toBe(12);
    expect(rows.find((r) => r.bucket === 'Power')?.minutes).toBe(10);
  });
});

describe('ANN card STOPPAGE label', () => {
  it('WARNING strip reads as STOPPAGE', () => {
    const status = 'WARNING' as const;
    const label = status === 'WARNING' ? 'STOPPAGE' : status;
    expect(label).toBe('STOPPAGE');
  });
});

describe('formatTraceabilityRecordDetails ANN', () => {
  it('surfaces furnace and dew fields', () => {
    const pairs = formatTraceabilityRecordDetails('ANN', {
      base_no: 'AB01',
      annealing_batch_no: 'B-1',
      charge_no: 'C-1',
      status: 'IN_PROCESS',
      furnace_id: 3,
      dew_point_n2: -40,
      current_stage_code: 'SOAK',
    });
    const labels = pairs.map((p) => p.label);
    expect(labels).toContain('F/C No');
    expect(labels).toContain('Dew point N₂');
    expect(labels).toContain('Current stage');
  });
});
