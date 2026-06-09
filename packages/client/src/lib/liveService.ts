import type {
  LiveOrderDetail,
  LiveOrderRow,
  LiveSnapshot,
  MachineHeadDashboardData,
  MachineStatusCard,
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
};