/**
 * changeRequestService — client wrapper for the change-request endpoints.
 *
 * A change request (CR) must be raised when a SUBMITTED or APPROVED shift log
 * needs modification. While a log is in SUBMITTED or APPROVED state, operator
 * edit controls are disabled and modification attempts are routed to this flow.
 *
 * Requirements: 6.4, 6.6
 */

import { apiClient } from '../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChangeRequestStatus = 'PENDING' | 'APPROVED' | 'APPLIED' | 'REJECTED';

export interface ChangeRequest {
  id: string;
  shiftLogId: string;
  tableName?: string;
  recordPk?: string;
  /** Mandatory reason for the change. */
  reason: string;
  /** Fields proposed for change. */
  proposedChanges: Record<string, unknown>;
  status: ChangeRequestStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  rejectionNote?: string;
}

export interface CreateChangeRequestPayload {
  shiftLogId: string;
  reason: string;
  proposedChanges?: Record<string, unknown>;
  tableName?: string;
  recordPk?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const changeRequestService = {
  /**
   * Creates a new change request for the given shift log.
   * Requirements: 6.4
   */
  create(payload: CreateChangeRequestPayload): Promise<ChangeRequest> {
    return apiClient.post<ChangeRequest>('/change-requests', payload);
  },

  /**
   * Lists all change requests for a given shift log.
   * Requirements: 6.4
   */
  listForShiftLog(shiftLogId: string): Promise<ChangeRequest[]> {
    return apiClient.get<ChangeRequest[]>(`/change-requests?shiftLogId=${shiftLogId}`);
  },

  /**
   * Approves a pending change request (supervisor+).
   * Requirements: 6.4
   */
  approve(id: string): Promise<ChangeRequest> {
    return apiClient.patch<ChangeRequest>(`/change-requests/${id}`, { action: 'APPROVE' });
  },

  /**
   * Rejects a pending change request (supervisor+).
   * Requirements: 6.4
   */
  reject(id: string, rejectionNote: string): Promise<ChangeRequest> {
    return apiClient.patch<ChangeRequest>(`/change-requests/${id}`, {
      action: 'REJECT',
      rejectionNote,
    });
  },
};
