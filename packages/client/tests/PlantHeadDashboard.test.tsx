import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PlantHeadDashboard } from '../src/pages/reports/PlantHeadDashboard';
import { reportingService } from '../src/lib/reportingService';
import { buildExtendedPlantHeadDashboardPayload } from './fixtures/plantHeadDashboard';

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

vi.mock('../src/services/machineHandoverService', () => ({
  machineHandoverService: {
    getOverview: vi.fn().mockResolvedValue({ pending: [], recent: [], awaitingAcceptance: 0 }),
  },
}));

vi.mock('../src/components/export/ExportProgressModal', () => ({
  ExportProgressModal: () => null,
}));

function renderDashboard() {
  return render(
    <MemoryRouter>
      <PlantHeadDashboard />
    </MemoryRouter>,
  );
}

describe('PlantHeadDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state before dashboard data arrives', async () => {
    let resolveLoad!: (value: ReturnType<typeof buildExtendedPlantHeadDashboardPayload>) => void;
    const pending = new Promise<ReturnType<typeof buildExtendedPlantHeadDashboardPayload>>((resolve) => {
      resolveLoad = resolve;
    });
    vi.mocked(reportingService.getExtendedPlantHeadDashboard).mockReturnValue(pending);

    renderDashboard();

    expect(screen.getByTestId('plant-head-dashboard-loading')).toBeDefined();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');

    resolveLoad(buildExtendedPlantHeadDashboardPayload());

    await waitFor(() => {
      expect(screen.getByTestId('plant-head-dashboard')).toBeDefined();
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(reportingService.getExtendedPlantHeadDashboard).mockRejectedValue(new Error('timeout'));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('plant-head-dashboard-error')).toBeDefined();
    });

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/timeout/i)).toBeDefined();
    expect(screen.queryByTestId('plant-head-dashboard')).toBeNull();
  });

  it('displays server error message from failed fetch', async () => {
    vi.mocked(reportingService.getExtendedPlantHeadDashboard).mockRejectedValue(
      new Error('500 Server Error'),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/500 Server Error/i)).toBeDefined();
    });
  });

  it('renders command center with KPI strip and chart sections after load', async () => {
    vi.mocked(reportingService.getExtendedPlantHeadDashboard).mockResolvedValue(
      buildExtendedPlantHeadDashboardPayload(),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('plant-head-dashboard')).toBeDefined();
    });

    expect(screen.getByRole('main', { name: /plant command center/i })).toBeDefined();
    expect(screen.getByTestId('plant-kpi-strip')).toBeDefined();
    expect(screen.getByRole('button', { name: /refresh dashboard/i })).toBeDefined();
    expect(screen.getByRole('combobox', { name: /reporting time window/i })).toBeDefined();
    expect(screen.getByText('90 MT')).toBeDefined();
    expect(screen.getByRole('heading', { name: /production performance/i })).toBeDefined();
    expect(screen.getByRole('heading', { name: /quality intelligence/i })).toBeDefined();
    expect(screen.getByRole('heading', { name: /downtime intelligence/i })).toBeDefined();
    expect(screen.getByTestId('production-vs-target-chart')).toBeDefined();
    expect(screen.getByTestId('top-defects-chart')).toBeDefined();
  });

  it('fetches dashboard with default 7-day window on mount', async () => {
    vi.mocked(reportingService.getExtendedPlantHeadDashboard).mockResolvedValue(
      buildExtendedPlantHeadDashboardPayload(),
    );

    renderDashboard();

    await waitFor(() => {
      expect(reportingService.getExtendedPlantHeadDashboard).toHaveBeenCalledWith(7, expect.any(Object));
    });
  });

  it('window selector triggers re-fetch with updated window', async () => {
    vi.mocked(reportingService.getExtendedPlantHeadDashboard).mockResolvedValue(
      buildExtendedPlantHeadDashboardPayload(),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('plant-head-dashboard')).toBeDefined();
    });

    expect(reportingService.getExtendedPlantHeadDashboard).toHaveBeenCalledWith(7, expect.any(Object));

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /reporting time window/i }),
      '30',
    );

    await waitFor(() => {
      expect(reportingService.getExtendedPlantHeadDashboard).toHaveBeenCalledWith(30, expect.any(Object));
    });
  });

  it('refresh button triggers a new fetch', async () => {
    vi.mocked(reportingService.getExtendedPlantHeadDashboard).mockResolvedValue(
      buildExtendedPlantHeadDashboardPayload(),
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('plant-head-dashboard')).toBeDefined();
    });

    const initialCalls = vi.mocked(reportingService.getExtendedPlantHeadDashboard).mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: /refresh dashboard/i }));

    await waitFor(() => {
      expect(vi.mocked(reportingService.getExtendedPlantHeadDashboard).mock.calls.length).toBeGreaterThan(
        initialCalls,
      );
    });
  });
});
