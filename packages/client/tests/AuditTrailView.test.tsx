import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { AuditTrailView } from '../src/pages/audit/AuditTrailView';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { auditService } from '../src/services/auditService';
import React from 'react';

vi.mock('../src/services/auditService', () => ({
  auditService: {
    query: vi.fn(),
  },
}));

describe('AuditTrailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders columns and has no mutate controls', async () => {
    (auditService.query as Mock).mockResolvedValueOnce({
      records: [
        {
          id: 1,
          table_name: 'process_entries',
          record_id: 'rec_123',
          action: 'UPDATE',
          field: 'status',
          old_value: 'DRAFT',
          new_value: 'COMPLETED',
          user_id: 42,
          timestamp: new Date().toISOString(),
        }
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    render(
      <MemoryRouter initialEntries={['/audit']}>
        <Routes>
          <Route path="/audit" element={<AuditTrailView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      // Check columns are present
      expect(screen.queryByText(/Audit Trail/i)).not.toBeNull();
    });

    // Check no mutate controls
    expect(screen.queryByRole('button', { name: /save|edit|delete|create/i })).toBeNull();
  });
});
