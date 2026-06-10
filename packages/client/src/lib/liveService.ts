import type {
  LiveOrderDetail,
  LiveOrderRow,
  LiveSnapshot,
  MachineCommandCenterData,
  MachineHeadDashboardData,
  MachineStatusCard,
  MachineUtilizationSummary,
} from '@m1/shared-validation';import { apiClient } from './apiClient';

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