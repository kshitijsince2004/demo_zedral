import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExecutiveNav, PLANT_HEAD_NAV_ITEMS } from '../src/components/layout/executive/ExecutiveNav';

// Mock auth store
const mockUseAuthStore = vi.fn();
vi.mock('../src/lib/authStore', () => ({
  useAuthStore: (selector: any) => selector({ role: mockUseAuthStore() }),
}));

describe('ExecutiveNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correct navigation items for PLANT_HEAD', () => {
    mockUseAuthStore.mockReturnValue('PLANT_HEAD');

    render(
      <MemoryRouter>
        <ExecutiveNav />
      </MemoryRouter>
    );

    // Expecting to find navigation items for Dashboard, Live, Import, Export, Trace, Audit Trail
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Live')).toBeDefined();
    expect(screen.getByText('Import')).toBeDefined();
    expect(screen.getByText('Export')).toBeDefined();
    expect(screen.getByText('Trace')).toBeDefined();
    expect(screen.getByText('Audit Trail')).toBeDefined();

    // Expecting not to find items meant for other roles only
    expect(screen.queryByText('Executive')).toBeNull();
    expect(screen.queryByText('DPR')).toBeNull();
  });

  it('exports PLANT_HEAD_NAV_ITEMS correctly', () => {
    expect(PLANT_HEAD_NAV_ITEMS).toEqual(['plant', 'live', 'import', 'export', 'trace', 'audit']);
  });
});
