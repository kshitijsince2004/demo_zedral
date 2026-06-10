import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { round1, round2 } from '../src/utils/kpiCalculator';
import {
  type PlantHeadDashboardPayload,
  validateDashboardPercentBounds,
  validatePerLineCoverage,
  validateTopNOrdering,
} from '../src/reporting/plantHeadValidators';

function buildPayloadFromShifts(
  lineIds: string[],
  defects: Array<{ code: string; count: number }>,
  downtime: Array<{ reason: string; minutes: number; occurrences: number }>,
): PlantHeadDashboardPayload {
  const productionVsPlan = lineIds.map((lineId) => {
    const planned = round1(Math.random() * 100);
    const actual = round1(Math.random() * 100);
    return {
      lineId,
      lineName: lineId,
      planned,
      actual,
      attainmentPct: planned > 0 ? round1(Math.min((actual / planned) * 100, 100)) : 0,
      throughput: round2(actual),
    };
  });

  const topDefects = [...defects]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((d) => ({
      defectCode: d.code,
      defectName: d.code,
      count: d.count,
      wowDelta: d.count,
    }));

  const downtimeDrivers = [...downtime]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 10)
    .map((d) => ({
      reason: d.reason,
      totalMinutes: d.minutes,
      occurrences: d.occurrences,
      type: 'UNPLANNED' as const,
    }));

  const plantWideOee = round1(Math.min(Math.max(Math.random() * 100, 0), 100));

  return {
    window: 7,
    generatedAt: new Date().toISOString(),
    plantWideOee,
    oeeTarget: 80,
    oeeTrend: [],
    productionVsPlan,
    qualityTrend: [
      {
        date: 'Mon',
        yieldPct: round1(Math.random() * 100),
        rejectionRatePct: round1(Math.random() * 100),
      },
    ],
    topDefects,
    downtimeDrivers,
    dailyProduction: [],
    kpiStrip: {
      productionTodayMt: round1(productionVsPlan.reduce((s, r) => s + r.actual, 0)),
      productionTodayTrendPct: 0,
      oeePct: plantWideOee,
      oeeTrendPct: 0,
      availabilityPct: plantWideOee,
      availabilityTrendPct: 0,
      performancePct: plantWideOee,
      performanceTrendPct: 0,
      qualityPct: round1(Math.random() * 100),
      qualityTrendPct: 0,
    },
  };
}

describe('Plant Head dashboard payload validators', () => {
  describe('Property 9: Dashboard percentage bounds and rounding', () => {
    it('plantWideOee and quality trend stay within [0, 100]', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 120, noNaN: true }),
          fc.float({ min: 0, max: 120, noNaN: true }),
          fc.float({ min: 0, max: 120, noNaN: true }),
          (rawOee, rawYield, rawRejection) => {
            const payload: PlantHeadDashboardPayload = {
              window: 7,
              generatedAt: new Date().toISOString(),
              plantWideOee: round1(Math.min(Math.max(rawOee, 0), 100)),
              oeeTarget: 80,
              oeeTrend: [],
              productionVsPlan: [],
              qualityTrend: [
                {
                  date: 'Mon',
                  yieldPct: round1(Math.min(Math.max(rawYield, 0), 100)),
                  rejectionRatePct: round1(Math.min(Math.max(rawRejection, 0), 100)),
                },
              ],
              topDefects: [],
              downtimeDrivers: [],
              dailyProduction: [],
              kpiStrip: {
                productionTodayMt: 0,
                productionTodayTrendPct: 0,
                oeePct: round1(Math.min(Math.max(rawOee, 0), 100)),
                oeeTrendPct: 0,
                availabilityPct: 0,
                availabilityTrendPct: 0,
                performancePct: 0,
                performanceTrendPct: 0,
                qualityPct: 0,
                qualityTrendPct: 0,
              },
            };
            expect(validateDashboardPercentBounds(payload)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 10: Top-N analytics cardinality and ordering', () => {
    it('topDefects and downtimeDrivers respect ≤10 and descending order', () => {
      fc.assert(
        fc.property(
          fc.array(fc.record({ code: fc.string(), count: fc.nat({ max: 500 }) }), {
            maxLength: 25,
          }),
          fc.array(
            fc.record({
              reason: fc.string(),
              minutes: fc.nat({ max: 5000 }),
              occurrences: fc.nat({ max: 100 }),
            }),
            { maxLength: 25 },
          ),
          (defects, downtime) => {
            const payload = buildPayloadFromShifts(['HRS', 'CRM'], defects, downtime);
            expect(validateTopNOrdering(payload)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 11: Per-line coverage with explicit empty states', () => {
    it('every line appears once with two-decimal throughput; empty lines → empty plan array', () => {
      fc.assert(
        fc.property(fc.array(fc.constantFrom('HRS', 'PKL', 'CRM', 'CRS'), { maxLength: 4 }), (lineIds) => {
          const unique = [...new Set(lineIds)];
          const payload = buildPayloadFromShifts(unique, [], []);
          expect(validatePerLineCoverage(unique, payload)).toBe(true);
        }),
        { numRuns: 100 },
      );

      const emptyPayload = buildPayloadFromShifts([], [], []);
      expect(validatePerLineCoverage([], emptyPayload)).toBe(true);
    });
  });
});
