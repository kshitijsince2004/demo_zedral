import { deleteQueued, patchQueued, postQueued } from './queuedApi';
import { apiClient } from '../apiClient';
import { getActiveCrmMill } from '../crmMillContext';
import type { SixHiOrderDetail } from '@m1/shared-validation';

const enc = encodeURIComponent;

/** Stamp mill on outbox URLs so replay works off the mill page (apiFetch pathname inject may miss). */
function withMillQuery(path: string): string {
  if (path.includes('machine=')) return path;
  const mill = getActiveCrmMill();
  if (!mill) return path;
  return path.includes('?') ? `${path}&machine=${enc(mill)}` : `${path}?machine=${enc(mill)}`;
}

/** Production PATCH must hit the server immediately — outbox queue causes end-before-sync failures. */
export function patchOrderImmediate(batchNumber: string, suffix: string, payload: unknown) {
  return apiClient.patch(`/6hi/orders/${enc(batchNumber)}/${suffix}`, payload);
}

/** Start must hit the server immediately so prodStartAt is available for the live timer. */
export function startOrderImmediate(batchNumber: string) {
  return apiClient.post<SixHiOrderDetail>(`/6hi/orders/${enc(batchNumber)}/start`, {});
}

/** Combined start must return prodStartAt before the operator timer can tick. */
export function startCombinedOrdersImmediate(batchNumbers: string[]) {
  return apiClient.post<{ orders: SixHiOrderDetail[] }>('/6hi/orders/start-combined', {
    batchNumbers,
    mode: 'start',
  });
}

/** Hub combine — group + PREPARING only; Start on the rail runs production. */
export function prepareCombinedOrdersImmediate(batchNumbers: string[]) {
  return apiClient.post<{ orders: SixHiOrderDetail[] }>('/6hi/orders/start-combined', {
    batchNumbers,
    mode: 'prepare',
  });
}

/** Combined end must carry combinedActualMt to the server in the same request (not a parked outbox row). */
export function endOrderImmediate(
  batchNumber: string,
  defectCodes: unknown,
  combinedActualMt?: number,
) {
  const payload: { defectCodes: unknown; combinedActualMt?: number } = { defectCodes };
  if (typeof combinedActualMt === 'number') {
    payload.combinedActualMt = combinedActualMt;
  }
  return apiClient.post(`/6hi/orders/${enc(batchNumber)}/end`, payload);
}

export function orderAggregateKey(batchNumber: string): string {
  return `6hi-order:${batchNumber}`;
}

export function machineAggregateKey(machineCode: string): string {
  return `6hi-machine:${machineCode}`;
}

export function postOrder(batchNumber: string, suffix: string, payload: unknown = {}) {
  return postQueued(
    withMillQuery(`/6hi/orders/${enc(batchNumber)}/${suffix}`),
    payload,
    orderAggregateKey(batchNumber),
  );
}

export function patchOrder(batchNumber: string, suffix: string, payload: unknown) {
  return patchQueued(
    withMillQuery(`/6hi/orders/${enc(batchNumber)}/${suffix}`),
    payload,
    orderAggregateKey(batchNumber),
  );
}

export function deleteOrder(batchNumber: string) {
  return deleteQueued(withMillQuery(`/6hi/orders/${enc(batchNumber)}`), orderAggregateKey(batchNumber));
}

export function startOrder(batchNumber: string) {
  return postOrder(batchNumber, 'start');
}

export function startCombinedOrders(batchNumbers: string[]) {
  const key = `6hi-combined:${[...batchNumbers].sort().join(',')}`;
  return postQueued('/6hi/orders/start-combined', { batchNumbers, mode: 'start' }, key);
}

export function endOrder(
  batchNumber: string,
  defectCodes: unknown,
  combinedActualMt?: number,
) {
  const payload: { defectCodes: unknown; combinedActualMt?: number } = { defectCodes };
  if (typeof combinedActualMt === 'number') {
    payload.combinedActualMt = combinedActualMt;
  }
  return postOrder(batchNumber, 'end', payload);
}

export function rejectOrder(
  batchNumber: string,
  payload: { rejectionReason: string; defectCodes: unknown; remarks?: string },
) {
  return postOrder(batchNumber, 'reject', payload);
}

export function addOrderRemark(batchNumber: string, text: string, defects: unknown) {
  return postOrder(batchNumber, 'remarks', { text, defects });
}

export function startStoppage(
  batchNumber: string,
  payload: { categoryCode: string; breakdownCode?: string; remarks?: string },
) {
  return postOrder(batchNumber, 'stoppages', payload);
}

export function updateStoppage(
  batchNumber: string,
  stoppageId: string,
  payload: { categoryCode: string; breakdownCode?: string; remarks?: string },
) {
  return patchOrder(batchNumber, `stoppages/${enc(stoppageId)}`, payload);
}

export function endStoppage(batchNumber: string, stoppageId: string) {
  return patchOrder(batchNumber, `stoppages/${enc(stoppageId)}/end`, {});
}

export function rollChange(batchNumber: string, data: unknown) {
  return postOrder(batchNumber, 'roll-change', data);
}

export function allocateMachine(batchNumber: string, machineCode: string) {
  return postQueued(
    `/6hi/orders/${enc(batchNumber)}/allocate-machine`,
    { machineCode },
    orderAggregateKey(batchNumber),
  );
}

export function transferMachines(machineCode: string, batchNumbers: string[]) {
  return postQueued(
    '/6hi/orders/transfer-machines',
    { machineCode, batchNumbers },
    `6hi-transfer:${machineCode}`,
  );
}

export async function transferOrderAssignment(
  payload: { batchNumbers: string[]; machineCode: string; reason?: string },
) {
  return postQueued<{ ok: boolean; results?: { batchNumber: string; ok: boolean; error?: string }[] }>(
    '/6hi/order-assignment/transfer',
    payload,
    `order-assignment:${payload.machineCode}`,
  );
}

export function createManualOrder(payload: unknown, machineCode: string) {
  return postQueued('/6hi/orders/manual', payload, machineAggregateKey(machineCode));
}

export function startManualStoppage(
  machine: string,
  payload: { categoryCode: string; breakdownCode?: string; remarks?: string },
) {
  return postQueued('/6hi/manual-stoppage/start', { machine, ...payload }, machineAggregateKey(machine));
}

export function patchManualStoppage(machine: string, payload: Record<string, unknown>) {
  return patchQueued('/6hi/manual-stoppage', { machine, ...payload }, machineAggregateKey(machine));
}

export function endManualStoppage(machine: string) {
  return postQueued('/6hi/manual-stoppage/end', { machine }, machineAggregateKey(machine));
}