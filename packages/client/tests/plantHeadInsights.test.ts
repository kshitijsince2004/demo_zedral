import { describe, it, expect } from 'vitest';
import { buildExecutiveInsights } from '../src/lib/plantHeadInsights';
import type { PlantHeadDashboardData } from '../src/lib/reportingService';

const base: PlantHeadDashboardData = {
  window: 7,
  generatedAt: new Date().toISOString(),
  plantWideOee: 82,
  oeeTarget: 80,
  oeeTrend: [],
  productionVsPlan: [
    {
      lineId: 'ANN',
      lineName: 'Annealing',
      planned: 100,
      actual: 94,
      attainmentPct: 94,
      throughput: 94,
    },
    {
      lineId: '6HI',
      lineName: 'CRM 6HI',
      planned: 120,
      actual: 70,
      attainmentPct: 58.3,
      throughput: 70,
    },
  ],
  qualityTrend: [],
  topDefects: [{ defectCode: 'RM', defectName: 'Roll Mark', count: 12, wowDelta: 2 }],
  downtimeDrivers: [],
  dailyProduction: [],
  kpiStrip: {
    productionTodayMt: 50,
    productionTodayTrendPct: 2.4,
    oeePct: 82,
    oeeTrendPct: 0,
    availabilityPct: 88,
    availabilityTrendPct: 0,
    performancePct: 80,
    performanceTrendPct: 0,
    qualityPct: 96,
    qualityTrendPct: 0,
  },
};

describe('buildExecutiveInsights', () => {
  it('uses API-backed production and defect data only', () => {
    const rows = buildExecutiveInsights(base);
    const production = rows.find((r) => r.label === 'Production vs plan (window)');
    expect(production?.value).toContain('74.5% attainment');
    expect(production?.value).toContain('+2.4%');

    const lowest = rows.find((r) => r.label === 'Lowest attainment line');
    expect(lowest?.value).toContain('CRM 6HI');

    const defect = rows.find((r) => r.label === 'Top defect (reporting window)');
    expect(defect?.value).toBe('Roll Mark · 12 recorded');
  });

  it('does not emit hardcoded placeholder strings', () => {
    const rows = buildExecutiveInsights(base);
    const values = rows.map((r) => r.value).filter(Boolean).join(' ');
    expect(values).not.toContain('Annealing (94% Util');
    expect(values).not.toContain('Roll Mark (14.2%)');
    expect(values).not.toContain('On Track');
  });
});
