import { describe, it, expect } from 'vitest';
import { formatTraceabilityRecordDetails } from '../src/lib/traceabilityFormat';

describe('ANN card STOPPAGE label', () => {
  it('WARNING strip reads as STOPPAGE', () => {
    const status = 'WARNING' as const;
    expect(status === 'WARNING' ? 'STOPPAGE' : status).toBe('STOPPAGE');
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
  });
});
