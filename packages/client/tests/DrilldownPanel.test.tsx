import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrilldownPanel } from '../src/components/reports/DrilldownPanel';
import { reportingService } from '../src/lib/reportingService';
import React from 'react';

vi.mock('../src/lib/reportingService', () => ({
  reportingService: {
    getPlantHeadDrilldown: vi.fn(),
  },
}));

describe('DrilldownPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders read-only paginated table and loads next 500', async () => {
    (reportingService.getPlantHeadDrilldown as any).mockResolvedValueOnce({
      metric: 'defects',
      window: 7,
      records: Array.from({ length: 500 }).map((_, i) => ({ id: `rec-${i}`, defect: 'Scratch' })),
      total: 1200,
      page: 1,
      pageSize: 500,
    });

    render(
      <DrilldownPanel open={true} onClose={() => {}} metric="defects" windowDays={7} />
    );

    await waitFor(() => {
      expect(screen.getByText(/Defect Log — last 7 days/i)).toBeDefined();
      expect(screen.getByText('rec-0')).toBeDefined();
      expect(screen.getByText(/Showing 500 of 1200 records/i)).toBeDefined();
    });

    // Check no mutate controls
    expect(screen.queryByRole('button', { name: /save|edit|delete|create/i })).toBeNull();

    // Load next 500
    (reportingService.getPlantHeadDrilldown as any).mockResolvedValueOnce({
      metric: 'defects',
      window: 7,
      records: Array.from({ length: 500 }).map((_, i) => ({ id: `rec-${i + 500}`, defect: 'Dent' })),
      total: 1200,
      page: 2,
      pageSize: 500,
    });

    const loadMoreBtn = screen.getByText('Load next 500');
    await userEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(reportingService.getPlantHeadDrilldown).toHaveBeenCalledWith('defects', 7, 2);
      expect(screen.getByText(/Showing 1000 of 1200 records/i)).toBeDefined();
      expect(screen.getByText('rec-500')).toBeDefined();
    });
  });
});
