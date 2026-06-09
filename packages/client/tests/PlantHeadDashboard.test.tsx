import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlantHeadDashboard } from '../src/pages/reports/PlantHeadDashboard';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { reportingService } from '../src/lib/reportingService';
import { machineHandoverService } from '../src/services/machineHandoverService';
import React from 'react';

vi.mock('../src/lib/reportingService', () => ({
  reportingService: {
    getPlantHeadDashboard: vi.fn(),
  },
}));

vi.mock('../src/services/machineHandoverService', () => ({
  machineHandoverService: {
    getOverview: vi.fn(),
  },
}));

vi.mock('../src/lib/syncEngine', () => ({
  syncEngine: {
    enqueue: vi.fn(),
    sync: vi.fn(),
    getPendingCount: vi.fn().mockResolvedValue(0),
    getPendingRequests: vi.fn().mockResolvedValue([]),
    onSyncStatusChange: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}));

describe('PlantHeadDashboard (Task 14.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (machineHandoverService.getOverview as any).mockResolvedValue({ pending: 0, recent: 0, awaitingAcceptance: 0 });
  });

  it('handles 10s timeout with empty payload and no fallback', async () => {
    // We mock getPlantHeadDashboard to take longer than 10s. Since test uses fake timers or real timers, 
    // we'll just mock it to reject with 'timeout' to simulate the fetchWithTimeout behavior 
    // or we mock it to never resolve and wait for the component's internal timeout.
    // For test speed, we'll mock it to reject with new Error('timeout')
    (reportingService.getPlantHeadDashboard as any).mockRejectedValue(new Error('timeout'));

    render(
      <MemoryRouter>
        <PlantHeadDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Live data is unavailable/i)).toBeDefined();
    });
  });

  it('handles route-level boundary + retry', async () => {
    (reportingService.getPlantHeadDashboard as any)
      .mockRejectedValueOnce(new Error('500 Server Error'))
      .mockResolvedValueOnce({
        window: 7,
        generatedAt: new Date().toISOString(),
        plantWideOee: 85,
        oeeTarget: 80,
        oeeTrend: [],
        productionVsPlan: [],
        qualityTrend: [],
        topDefects: [],
        downtimeDrivers: []
      });

    render(
      <MemoryRouter>
        <PlantHeadDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Plant overview could not be loaded/i)).toBeDefined();
    });

    // click retry
    const retryBtn = screen.getByText('Retry');
    await userEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Plant overview could not be loaded/i)).toBeNull();
      expect(screen.getByText(/Plant OEE/i)).toBeDefined();
    });
  });

  it('window selector triggers re-fetch', async () => {
    (reportingService.getPlantHeadDashboard as any).mockResolvedValue({
      window: 7,
      generatedAt: new Date().toISOString(),
      plantWideOee: 85,
      oeeTarget: 80,
      oeeTrend: [],
      productionVsPlan: [],
      qualityTrend: [],
      topDefects: [],
      downtimeDrivers: []
    });

    render(
      <MemoryRouter initialEntries={['/plant']}>
        <Routes>
          <Route path="/plant" element={<PlantHeadDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Plant OEE/i)).toBeDefined();
    });

    expect(reportingService.getPlantHeadDashboard).toHaveBeenCalledWith(7);

    // Click 30d
    const btn30d = screen.getByText('30d');
    await userEvent.click(btn30d);

    await waitFor(() => {
      expect(reportingService.getPlantHeadDashboard).toHaveBeenCalledWith(30);
    });
  });
});
