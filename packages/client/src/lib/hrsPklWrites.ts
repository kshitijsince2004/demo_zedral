import { apiClient } from './apiClient';

/** Running-order detail shared by HRS/PKL getOrder responses. */
export type HrsPklOrderDetail = {
  status: string;
  coilNo: string;
  prodStartAt?: string;
  activeStoppageId?: string;
  stoppages?: Array<{ stoppageId: string; startAt: string; endAt?: string }>;
};

export async function fetchHrsOrder(coilNo: string): Promise<HrsPklOrderDetail> {
  return apiClient.get(`/hrs-order/orders/${encodeURIComponent(coilNo)}`);
}

export async function fetchPklOrder(coilNo: string): Promise<HrsPklOrderDetail> {
  return apiClient.get(`/pkl-order/orders/${encodeURIComponent(coilNo)}`);
}

export async function fetchHrsPklOrder(
  processCode: 'HRS' | 'PKL',
  coilNo: string,
): Promise<HrsPklOrderDetail> {
  return processCode === 'HRS' ? fetchHrsOrder(coilNo) : fetchPklOrder(coilNo);
}

/** Map getOrder → hydrateProcessRun input. */
export function orderToHydrateInput(order: HrsPklOrderDetail) {
  const open = order.stoppages?.find((s) => !s.endAt);
  return {
    coilNo: order.coilNo,
    status: order.status,
    prodStartAt: order.prodStartAt ?? null,
    stoppageStartedAt: open?.startAt ?? null,
    activeStoppageId: order.activeStoppageId ?? open?.stoppageId ?? null,
    stoppages: order.stoppages,
  };
}

export type PklManualStoppageStatus = {
  eligible: boolean;
  active: {
    eventId: string;
    categoryCode?: string;
    categoryLabel?: string;
    breakdownCode?: string;
    reason?: string;
    startedAt: string;
    shiftCode?: string;
  } | null;
};

export type ProcessManualStoppageStatus = PklManualStoppageStatus;

export function fetchPklManualStoppage(): Promise<PklManualStoppageStatus> {
  return apiClient.get('/stations/pkl/manual-stoppage');
}

export function startPklManualStoppage(payload: {
  categoryCode: string;
  breakdownCode?: string;
  remarks?: string;
}): Promise<PklManualStoppageStatus> {
  return apiClient.post('/stations/pkl/manual-stoppage/start', payload);
}

export function patchPklManualStoppage(payload: {
  categoryCode: string;
  breakdownCode?: string;
  remarks?: string;
}): Promise<PklManualStoppageStatus> {
  return apiClient.patch('/stations/pkl/manual-stoppage', payload);
}

export function endPklManualStoppage(): Promise<PklManualStoppageStatus> {
  return apiClient.post('/stations/pkl/manual-stoppage/end', {});
}

export function fetchHrsManualStoppage(): Promise<ProcessManualStoppageStatus> {
  return apiClient.get('/stations/hrs/manual-stoppage');
}

export function startHrsManualStoppage(payload: {
  categoryCode: string;
  breakdownCode?: string;
  remarks?: string;
}): Promise<ProcessManualStoppageStatus> {
  return apiClient.post('/stations/hrs/manual-stoppage/start', payload);
}

export function patchHrsManualStoppage(payload: {
  categoryCode: string;
  breakdownCode?: string;
  remarks?: string;
}): Promise<ProcessManualStoppageStatus> {
  return apiClient.patch('/stations/hrs/manual-stoppage', payload);
}

export function endHrsManualStoppage(): Promise<ProcessManualStoppageStatus> {
  return apiClient.post('/stations/hrs/manual-stoppage/end', {});
}
