import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlantKpiStrip } from '../src/components/plant-head/PlantKpiStrip';
import type { ExtendedPlantHeadDashboardData } from '../src/lib/reportingService';

function buildData(overrides: Partial<ExtendedPlantHeadDashboardData> = {}): ExtendedPlantHeadDashboardData {
  return {
    window: 7,
    generatedAt: new Date().toISOString(),
    plantWideOee: 85,
    oeeTarget: 80,
    oeeTrend: [],
    productionVsPlan: [],
    qualityTrend: [],
    topDefects: [],
    downtimeDrivers: [],
    dailyProduction: [],
    kpiStrip: {
      productionTodayMt: 120,
      productionTodayTrendPct: 4.5,
      oeePct: 85,
      oeeTrendPct: -1.2,
      availabilityPct: 88,
      availabilityTrendPct: 0.8,
      performancePct: 82,
      performanceTrendPct: -0.4,
      qualityPct: 96,
      qualityTrendPct: 0.3,
      utilizationPct: 88,
      utilizationTrendPct: 0.8,
    },
    productionToday: 120,
    productionTarget: 150,
    productionShift: 120,
    productionShiftTarget: 150,
    productionMonth: 900,
    productionMonthTarget: 1000,
    productionForecast: 1000,
    productionTodayMt: 120,
    productionTrend: '+4.5%',
    shiftProductionMt: 120,
    overallUtilizationPct: 88,
    oeePct: 85,
    runningMachines: 2,
    breakdownMachines: 0,
    utilizationPct: 88,
    availabilityPct: 88,
    mttrHours: 0,
    mtbfHours: 0,
    runningOrders: 2,
    delayedOrders: 0,
    defectsToday: 0,
    defectPct: 0,
    defectTrend: [],
    activeAlerts: 0,
    criticalAlerts: [],
    opsFeed: [],
    dailyProduction: [],
    weeklyProduction: [],
    monthlyProduction: [],
    productionVsTarget: [],
    defectsByCategory: [],
    downtimeByCategory: [],
    lineAttainment: [],
    ...overrides,
  };
}

describe('PlantKpiStrip', () => {
  it('renders API-backed KPI values and trends', () => {
    render(<PlantKpiStrip data={buildData()} />);

    expect(screen.getByText('Production Today')).toBeDefined();
    expect(screen.getByText('120 MT')).toBeDefined();
    expect(screen.getByText('+4.5%')).toBeDefined();
    expect(screen.getByText('OEE')).toBeDefined();
    expect(screen.getByText('-1.2%')).toBeDefined();
    expect(screen.getByText('Availability')).toBeDefined();
    expect(screen.getByText('Performance')).toBeDefined();
    expect(screen.getByText('Quality')).toBeDefined();
    expect(screen.getByText('Utilization')).toBeDefined();
  });

  it('does not render hardcoded placeholder trends', () => {
    render(<PlantKpiStrip data={buildData()} />);

    expect(screen.queryByText('+1.2%')).toBeNull();
    expect(screen.queryByText('+0.5%')).toBeNull();
    expect(screen.queryByText('-0.3%')).toBeNull();
  });

  it('uses live utilization value when live KPIs are present', () => {
    render(
      <PlantKpiStrip
        data={buildData()}
        liveKpis={{
          runningMachines: 3,
          idleMachines: 1,
          breakdownMachines: 0,
          activeOrders: 5,
          currentProductionMt: 50,
          currentStoppages: 1,
          utilizationPct: 75,
          shiftPerformancePct: 60,
        }}
      />,
    );

    expect(screen.getByText('75%')).toBeDefined();
  });
});
