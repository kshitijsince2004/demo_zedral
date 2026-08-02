import { apiClient } from './apiClient';

export type RwdOrderStatus =
  | 'PENDING'
  | 'PREPARING'
  | 'IN_PROGRESS'
  | 'STOPPAGE'
  | 'COMPLETED'
  | 'REJECTED';

export async function startRwdOrder(batchNumber: string) {
  return apiClient.post(`/rewinding/orders/${encodeURIComponent(batchNumber)}/start`);
}

export async function endRwdOrder(batchNumber: string) {
  return apiClient.post(`/rewinding/orders/${encodeURIComponent(batchNumber)}/end`);
}

export async function allocateRwdMachine(batchNumber: string, machineCode: string) {
  return apiClient.post(`/rewinding/orders/${encodeURIComponent(batchNumber)}/allocate-machine`, {
    machineCode,
  });
}

export async function startCombinedRwdOrders(batchNumbers: string[]) {
  return apiClient.post('/rewinding/orders/start-combined', { batchNumbers });
}

export async function addRwdStoppage(
  batchNumber: string,
  body: { categoryCode: string; breakdownCode?: string; remarks?: string },
) {
  return apiClient.post(`/rewinding/orders/${encodeURIComponent(batchNumber)}/stoppages`, body);
}

export async function endRwdStoppage(batchNumber: string, stoppageId: string) {
  return apiClient.patch(
    `/rewinding/orders/${encodeURIComponent(batchNumber)}/stoppages/${encodeURIComponent(stoppageId)}/end`,
  );
}

export async function updateRwdStoppage(
  batchNumber: string,
  stoppageId: string,
  body: { categoryCode: string; breakdownCode?: string; remarks?: string },
) {
  return apiClient.patch(
    `/rewinding/orders/${encodeURIComponent(batchNumber)}/stoppages/${encodeURIComponent(stoppageId)}`,
    body,
  );
}

export async function rejectRwdOrder(batchNumber: string, rejectionReason: string, remarks: string) {
  return apiClient.post(`/rewinding/orders/${encodeURIComponent(batchNumber)}/reject`, {
    rejectionReason,
    remarks,
  });
}

export async function reinstateRwdOrder(batchNumber: string, target?: 'PREPARING' | 'PENDING') {
  return apiClient.post(`/rewinding/orders/${encodeURIComponent(batchNumber)}/reinstate`, { target });
}

export async function captureRwdOrder(batchNumber: string, body: Record<string, unknown>) {
  return apiClient.patch(`/rewinding/orders/${encodeURIComponent(batchNumber)}/capture`, body);
}

export async function createManualRwdOrder(body: Record<string, unknown>) {
  return apiClient.post('/rewinding/orders/manual', body);
}

export async function fetchRwdOrder(batchNumber: string) {
  return apiClient.get(`/rewinding/orders/${encodeURIComponent(batchNumber)}`);
}
