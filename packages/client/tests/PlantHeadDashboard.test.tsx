import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlantHeadDashboard } from '../src/pages/reports/PlantHeadDashboard';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { reportingService } from '../src/lib/reportingService';
import React from 'react';

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
};

vi.mock('../src/lib/reportingService', () => ({
  reportingService: {
    getExtendedPlantHeadDashboard: vi.fn(),
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
        dailyProduction: [],
        weeklyProduction: [],
        monthlyProduction: [],
        productionVsTarget: [],
        defectsByCategory: [],
        defectsByMachine: [],
        downtimeByCategory: [],
        machineHealthGrid: [],
        orderList: [],
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
      dailyProduction: [],
      weeklyProduction: [],
      monthlyProduction: [],
      productionVsTarget: [],
      defectsByCategory: [],
      defectsByMachine: [],
      downtimeByCategory: [],
      machineHealthGrid: [],
      orderList: [],
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
