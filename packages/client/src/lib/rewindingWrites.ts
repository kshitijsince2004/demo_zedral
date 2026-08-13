import { apiClient } from './apiClient';
import { patchQueued } from './sync/queuedApi';

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

function rwdMachineQuery(machine?: string) {
  return machine ? `?machine=${encodeURIComponent(machine)}` : '';
}

export async function startCombinedRwdOrders(batchNumbers: string[], machine?: string) {
  return apiClient.post(`/rewinding/orders/start-combined${rwdMachineQuery(machine)}`, { batchNumbers, mode: 'start' });
}

/** Hub combine — PREPARING + group; capture Start actually runs. */
export async function prepareCombinedRwdOrders(batchNumbers: string[], machine?: string) {
  return apiClient.post(`/rewinding/orders/start-combined${rwdMachineQuery(machine)}`, { batchNumbers, mode: 'prepare' });
}

/** Dissolve PREPARING combined_group_id (hub Cancel Combined after prepare). */
export async function cancelCombinedRwdOrders(batchNumbers: string[], machine?: string) {
  return apiClient.post(`/rewinding/orders/cancel-combined${rwdMachineQuery(machine)}`, { batchNumbers });
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

/** Offline-queued capture — mirrors sixHiWrites patchQueued. */
export async function captureRwdOrder(batchNumber: string, body: Record<string, unknown>) {
  return patchQueued(
    `/rewinding/orders/${encodeURIComponent(batchNumber)}/capture`,
    body,
    `rwd-capture:${batchNumber}`,
  );
}

export async function createManualRwdOrder(body: Record<string, unknown>) {
  return apiClient.post('/rewinding/orders/manual', body);
}

export async function fetchRwdOrder(batchNumber: string) {
  return apiClient.get(`/rewinding/orders/${encodeURIComponent(batchNumber)}`);
}
