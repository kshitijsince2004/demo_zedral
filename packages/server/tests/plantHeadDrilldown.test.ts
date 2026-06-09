import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DRILLDOWN_PAGE_SIZE,
  PLANT_HEAD_DRILLDOWN_METRICS,
  buildDrilldownEnvelope,
  paginateRecords,
  parsePlantHeadDrilldownMetric,
  validatePaginationPartition,
} from '../src/reporting/plantHeadDrilldown';

describe('plantHeadDrilldown parsing and pagination', () => {
  it('accepts valid metrics', () => {
    for (const metric of PLANT_HEAD_DRILLDOWN_METRICS) {
      expect(parsePlantHeadDrilldownMetric(metric)).toEqual({ ok: true, metric });
      expect(parsePlantHeadDrilldownMetric(metric.toUpperCase())).toEqual({ ok: true, metric });
    }
  });

  it('rejects missing and invalid metrics', () => {
    expect(parsePlantHeadDrilldownMetric(undefined)).toEqual({ ok: false, error: 'MISSING_METRIC' });
    expect(parsePlantHeadDrilldownMetric('')).toEqual({ ok: false, error: 'MISSING_METRIC' });
    expect(parsePlantHeadDrilldownMetric('yield')).toEqual({
      ok: false,
      error: 'INVALID_METRIC',
      value: 'yield',
    });
  });

  describe('Property 3: Drilldown metric validity', () => {
    it('runs only for recognized metrics; missing/invalid are rejected', () => {
      fc.assert(
        fc.property(fc.oneof(fc.string(), fc.constant(undefined)), (raw) => {
          const parsed = parsePlantHeadDrilldownMetric(raw);
          if (raw === undefined || raw === null || raw === '') {
            expect(parsed.ok).toBe(false);
            if (!parsed.ok) expect(parsed.error).toBe('MISSING_METRIC');
            return;
          }
          const normalized = String(raw).trim().toLowerCase();
          if ((PLANT_HEAD_DRILLDOWN_METRICS as readonly string[]).includes(normalized)) {
            expect(parsed.ok).toBe(true);
          } else {
            expect(parsed.ok).toBe(false);
            if (!parsed.ok) expect(parsed.error).toBe('INVALID_METRIC');
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 5: Drilldown pagination partitions the match set', () => {
    it('pages are ≤500, partition exactly, and total is stable', () => {
      fc.assert(
        fc.property(
          fc.array(fc.nat(), { maxLength: 2500 }),
          fc.integer({ min: 1, max: 500 }),
          (records, pageSize) => {
            expect(validatePaginationPartition(records, pageSize)).toBe(true);

            const totalPages = Math.ceil(records.length / pageSize) || 1;
            for (let page = 1; page <= totalPages; page++) {
              const slice = paginateRecords(records, page, pageSize);
              expect(slice.records.length).toBeLessThanOrEqual(pageSize);
              expect(slice.total).toBe(records.length);
              expect(slice.page).toBe(page);
            }

            if (records.length === 0) {
              const empty = buildDrilldownEnvelope('oee', 7, [], 1);
              expect(empty.records).toEqual([]);
              expect(empty.total).toBe(0);
              expect(empty.pageSize).toBe(DRILLDOWN_PAGE_SIZE);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
