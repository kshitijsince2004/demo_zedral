import { describe, it, expect } from 'vitest';
import { DprAggregator } from '../../src/export/aggregation/DprAggregator';
import { bindDprWorkbook } from '../../src/export/layouts/TemplateBinder';
import { buildDprFromFixture } from '../../src/export/definitions/DprReport';
import fixture from '../fixtures/export/may2026_subset.json';

describe('DPR performance (Phase 7)', () => {
  it('full fixture aggregation + bind completes under 10 seconds', () => {
    const start = Date.now();
    const { rdm, bound } = buildDprFromFixture({
      month: fixture.month,
      runs: fixture.runs as any,
      stoppages: fixture.stoppages as any,
      dispositions: fixture.dispositions as any,
      targets: fixture.targets as any,
    });
    expect(rdm.days.length).toBeGreaterThan(0);
    expect(bound.monthCells.length).toBeGreaterThan(0);
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it('empty month aggregation is fast', () => {
    const start = Date.now();
    const rdm = DprAggregator.aggregate({
      month: '2026-05',
      runs: [],
      stoppages: [],
      dispositions: [],
      targets: [],
    });
    bindDprWorkbook(rdm);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
