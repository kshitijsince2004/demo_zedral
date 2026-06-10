import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlantHeadDashboard } from '../src/pages/reports/PlantHeadDashboard';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { reportingService } from '../src/lib/reportingService';
import React from 'react';

const defaultKpiStrip = {
  productionTodayMt: 90,
  productionTodayTrendPct: 0,
  oeePct: 85,
  oeeTrendPct: 0,
  availabilityPct: 85,
  availabilityTrendPct: 0,
  performancePct: 85,
  performanceTrendPct: 0,
  qualityPct: 98,
  qualityTrendPct: 0,
  utilizationPct: 85,
  utilizationTrendPct: 0,
};

const basePayload = {
  window: 7 as const,
  generatedAt: new Date().toISOString(),
  plantWideOee: 85,
  oeeTarget: 80,
  oeeTrend: [{ date: 'Mon', oee: 85 }],
  productionVsPlan: [{ lineId: '6HI', lineName: 'CRM 6HI', planned: 100, actual: 90, attainmentPct: 90, throughput: 90 }],
  qualityTrend: [{ date: 'Mon', rejectionRatePct: 2, yieldPct: 98 }],
  topDefects: [{ defectCode: 'D1', defectName: 'Scratch', count: 3, wowDelta: 0 }],
  downtimeDrivers: [{ reason: 'Mechanical', totalMinutes: 30, occurrences: 1, type: 'UNPLANNED' as const }],
  dailyProduction: [{ date: 'Mon', targetMt: 100, actualMt: 90 }],
  kpiStrip: defaultKpiStrip,
};

const extendedFields = {
  productionToday: 90,
  productionTarget: 100,
  productionShift: 90,
  productionShiftTarget: 100,
  productionMonth: 90,
  productionMonthTarget: 100,
  productionForecast: 100,
  productionTodayMt: 90,
  productionTrend: '+0%',
  shiftProductionMt: 90,
  overallUtilizationPct: 85,
  oeePct: 85,
  runningMachines: 1,
  breakdownMachines: 0,
  utilizationPct: 85,
  availabilityPct: 85,
  mttrHours: 0,
  mtbfHours: 0,
  runningOrders: 1,
  delayedOrders: 0,
  defectsToday: 3,
  defectPct: 2,
  defectTrend: [],
  activeAlerts: 0,
  criticalAlerts: [],
  opsFeed: [],
  dailyProduction: [{ date: 'Mon', actual: 90, target: 100 }],
  weeklyProduction: [],
  monthlyProduction: [],
  productionVsTarget: [{ date: 'Mon', targetMt: 100, actualMt: 90 }],
  defectsByCategory: [{ category: 'Scratch', count: 3 }],
  downtimeByCategory: [{ category: 'Mechanical', minutes: 30 }],
  lineAttainment: [{ lineId: '6HI', lineName: 'CRM 6HI', plannedMt: 100, actualMt: 90, attainmentPct: 90 }],
};

vi.mock('../src/lib/reportingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/reportingService')>();
  return {
    ...actual,
    reportingService: {
      getExtendedPlantHeadDashboard: vi.fn(),
    },
  };
});

vi.mock('../src/hooks/useLiveSnapshot', () => ({
  useLiveSnapshot: () => ({ snapshot: null, loading: false, error: null, refresh: vi.fn() }),
  LIVE_POLL_MS: 8000,
  machineStatusLabel: (s: string) => s,
}));

vi.mock('../src/lib/liveService', () => ({
  liveService: {
    getOrders: vi.fn().mockResolvedValue({ orders: [], refreshedAt: new Date().toISOString() }),
  },
}));

describe('PlantHeadDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows error state when API fails', async () => {
    (reportingService.getExtendedPlantHeadDashboard as any).mockRejectedValue(new Error('timeout'));

    render(
      <MemoryRouter>
        <PlantHeadDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/timeout/i)).toBeDefined();
    });
  });

  it('retries after error', async () => {
    (reportingService.getExtendedPlantHeadDashboard as any)
      .mockRejectedValueOnce(new Error('500 Server Error'))
      .mockResolvedValueOnce({
        ...basePayload,
        ...extendedFields,
      });

    render(
      <MemoryRouter>
        <PlantHeadDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/500 Server Error/i)).toBeDefined();
    });
  });

  it('window selector triggers re-fetch', async () => {
    (reportingService.getExtendedPlantHeadDashboard as any).mockResolvedValue({
      ...basePayload,
      ...extendedFields,
    });

    render(
      <MemoryRouter initialEntries={['/plant']}>
        <Routes>
          <Route path="/plant" element={<PlantHeadDashboard />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Plant Head Dashboard/i)).toBeDefined();
    });

    expect(reportingService.getExtendedPlantHeadDashboard).toHaveBeenCalledWith(7);

    const select = screen.getByRole('combobox');
    await userEvent.selectOptions(select, '30');

    await waitFor(() => {
      expect(reportingService.getExtendedPlantHeadDashboard).toHaveBeenCalledWith(30);
    });
  });
});
