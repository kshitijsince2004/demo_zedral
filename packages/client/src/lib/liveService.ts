import type {
  LiveOrderDetail,
  LiveOrderRow,
  LiveSnapshot,
  MachineCommandCenterData,
  MachineHeadDashboardData,
  MachineStatusCard,
  MachineUtilizationSummary,
  RejectedOrderRow,
} from '@m1/shared-validation';
import { apiClient } from './apiClient';

export const liveService = {
  getSnapshot: () => apiClient.get<LiveSnapshot>('/live/snapshot'),

  getOrders: () =>
    apiClient.get<{ orders: LiveOrderRow[]; refreshedAt: string }>('/live/orders'),

  getOrderDetail: (batchNo: string) =>
    apiClient.get<LiveOrderDetail>(`/live/orders/${encodeURIComponent(batchNo)}`),

  getMachines: () =>
    apiClient.get<{ machines: MachineStatusCard[]; refreshedAt: string }>('/live/machines'),

  getMachineHeadDashboard: () =>
    apiClient.get<MachineHeadDashboardData>('/live/machine-head-dashboard'),

  getRejectedOrders: (params?: { date?: string; dateFrom?: string; dateTo?: string; shiftCode?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set('date', params.date);
    if (params?.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params?.dateTo) q.set('dateTo', params.dateTo);
    if (params?.shiftCode) q.set('shiftCode', params.shiftCode);
    if (params?.limit != null) q.set('limit', String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return apiClient.get<{ orders: RejectedOrderRow[]; refreshedAt: string }>(`/live/rejected-orders${suffix}`);
  },

  getMachineState: (machineCode: string) =>
    apiClient.get<MachineCommandCenterData>(`/live/machines/${encodeURIComponent(machineCode)}/state`),

  getMachineTimeline: (machineCode: string, hours = 24) =>
    apiClient.get<{ machineCode: string; hours: number; timeline: MachineCommandCenterData['timeline']; refreshedAt: string }>(
      `/live/machines/${encodeURIComponent(machineCode)}/timeline?hours=${hours}`,
    ),

  getMachineAnalytics: (machineCode: string, hours = 24) =>
    apiClient.get<MachineUtilizationSummary>(
      `/live/machines/${encodeURIComponent(machineCode)}/analytics?hours=${hours}`,
    ),
};