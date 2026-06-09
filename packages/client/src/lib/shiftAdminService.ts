import { apiClient } from './apiClient';

export interface ShiftWindow {
  shift_code: string;
  name: string;
  start_time: string;
  end_time: string;
}

export interface ShiftAuditEvent {
  eventId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  machineCode?: string;
  username?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export const shiftAdminService = {
  getWindows: () =>
    apiClient.get<{ windows: ShiftWindow[]; timezone: string }>('/shifts/windows'),

  updateWindow: (shiftCode: string, startTime: string, endTime: string) =>
    apiClient.put<{ windows: ShiftWindow[]; timezone: string }>(
      `/shifts/windows/${encodeURIComponent(shiftCode)}`,
      { startTime, endTime },
    ),

  getAudit: (opts?: { limit?: number; eventType?: string }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.eventType) params.set('eventType', opts.eventType);
    const q = params.toString();
    return apiClient.get<{ events: ShiftAuditEvent[] }>(`/shifts/audit${q ? `?${q}` : ''}`);
  },
};
