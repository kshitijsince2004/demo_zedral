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

  getOrders: (params?: { machine?: string; search?: string; subProcess?: string }) => {
    const q = new URLSearchParams();
    if (params?.machine && params.machine !== 'ALL') q.set('machine', params.machine);
    if (params?.search?.trim()) q.set('search', params.search.trim());
    if (params?.subProcess && params.subProcess !== 'ALL') q.set('subProcess', params.subProcess);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return apiClient.get<{ orders: LiveOrderRow[]; refreshedAt: string }>(`/live/orders${suffix}`);
  },

  getOrderDetail: (batchNo: string) =>
    apiClient.get<LiveOrderDetail>(`/live/orders/${encodeURIComponent(batchNo)}`),

  getMachines: () =>
    apiClient.get<{ machines: MachineStatusCard[]; refreshedAt: string }>('/live/machines'),

  getMachineHeadDashboard: (params?: { machine?: string; search?: string; subProcess?: string }) => {
    const q = new URLSearchParams();
    if (params?.machine && params.machine !== 'ALL') q.set('machine', params.machine);
    if (params?.search?.trim()) q.set('search', params.search.trim());
    if (params?.subProcess && params.subProcess !== 'ALL') q.set('subProcess', params.subProcess);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return apiClient.get<MachineHeadDashboardData>(`/live/machine-head-dashboard${suffix}`);
  },
  getRejectedOrders: (params?: {
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    shiftCode?: string;
    machine?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set('date', params.date);
    if (params?.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params?.dateTo) q.set('dateTo', params.dateTo);
    if (params?.shiftCode) q.set('shiftCode', params.shiftCode);
    if (params?.machine && params.machine !== 'ALL') q.set('machine', params.machine);
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