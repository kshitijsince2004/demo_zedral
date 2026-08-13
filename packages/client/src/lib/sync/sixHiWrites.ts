import { apiClient } from '../apiClient';
import { computeIdempotencyKey, withTapLock } from '../idempotencyKey';
import type { SixHiOrderDetail } from '@m1/shared-validation';

const enc = encodeURIComponent;

async function withIdempotentWrite<T>(
  aggregateKey: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload: unknown,
  send: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  const key = await computeIdempotencyKey({ aggregateKey, method, url, payload });
  return withTapLock(aggregateKey, () => send({ 'X-Idempotency-Key': key }));
}

/** Production PATCH must hit the server immediately — outbox queue causes end-before-sync failures. */
export function patchOrderImmediate(batchNumber: string, suffix: string, payload: unknown) {
  const url = `/6hi/orders/${enc(batchNumber)}/${suffix}`;
  return withIdempotentWrite(orderAggregateKey(batchNumber), 'PATCH', url, payload, (headers) =>
    apiClient.patch(url, payload, { headers }),
  );
}

/** Start must hit the server immediately so prodStartAt is available for the live timer. */
export function startOrderImmediate(batchNumber: string) {
  const url = `/6hi/orders/${enc(batchNumber)}/start`;
  return withIdempotentWrite(orderAggregateKey(batchNumber), 'POST', url, {}, (headers) =>
    apiClient.post<SixHiOrderDetail>(url, {}, { headers }),
  );
}

/** Combined start must return prodStartAt before the operator timer can tick. */
export function startCombinedOrdersImmediate(batchNumbers: string[]) {
  const payload = { batchNumbers, mode: 'start' };
  return withIdempotentWrite(
    orderAggregateKey(batchNumbers[0] ?? 'combined'),
    'POST',
    '/6hi/orders/start-combined',
    payload,
    (headers) => apiClient.post<{ orders: SixHiOrderDetail[] }>('/6hi/orders/start-combined', payload, { headers }),
  );
}

/** Hub combine — group + PREPARING only; Start on the rail runs production. */
export function prepareCombinedOrdersImmediate(batchNumbers: string[]) {
  const payload = { batchNumbers, mode: 'prepare' };
  return withIdempotentWrite(
    orderAggregateKey(batchNumbers[0] ?? 'combined'),
    'POST',
    '/6hi/orders/start-combined',
    payload,
    (headers) => apiClient.post<{ orders: SixHiOrderDetail[] }>('/6hi/orders/start-combined', payload, { headers }),
  );
}

/** Dissolve PREPARING combined_group_id (hub Cancel Combined after prepare). */
export function cancelCombinedOrdersImmediate(batchNumbers: string[]) {
  const payload = { batchNumbers };
  return withIdempotentWrite(
    orderAggregateKey(batchNumbers[0] ?? 'combined'),
    'POST',
    '/6hi/orders/cancel-combined',
    payload,
    (headers) => apiClient.post<{ orders: SixHiOrderDetail[] }>('/6hi/orders/cancel-combined', payload, { headers }),
  );
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
  const url = `/6hi/orders/${enc(batchNumber)}/end`;
  return withIdempotentWrite(orderAggregateKey(batchNumber), 'POST', url, payload, (headers) =>
    apiClient.post(url, payload, { headers }),
  );
}

export function orderAggregateKey(batchNumber: string): string {
  return `6hi-order:${batchNumber}`;
}

export function machineAggregateKey(machineCode: string): string {
  return `6hi-machine:${machineCode}`;
}

/** @deprecated Prefer startOrderImmediate — kept as alias so old imports cannot reintroduce outbox races. */
export function startOrder(batchNumber: string) {
  return startOrderImmediate(batchNumber);
}

/** @deprecated Prefer endOrderImmediate. */
export function endOrder(
  batchNumber: string,
  defectCodes: unknown,
  combinedActualMt?: number,
) {
  return endOrderImmediate(batchNumber, defectCodes, combinedActualMt);
}

/** Hold/reject must hit the server immediately — outbox race closed the console while status stayed live. */
export function rejectOrderImmediate(
  batchNumber: string,
  payload: { rejectionReason: string; defectCodes: unknown; remarks?: string },
) {
  const url = `/6hi/orders/${enc(batchNumber)}/reject`;
  return withIdempotentWrite(orderAggregateKey(batchNumber), 'POST', url, payload, (headers) =>
    apiClient.post<SixHiOrderDetail>(url, payload, { headers }),
  );
}

export function rejectOrder(
  batchNumber: string,
  payload: { rejectionReason: string; defectCodes: unknown; remarks?: string },
) {
  return rejectOrderImmediate(batchNumber, payload);
}

export function addOrderRemark(batchNumber: string, text: string, defects: unknown) {
  return apiClient.post(`/6hi/orders/${enc(batchNumber)}/remarks`, { text, defects });
}

export function startStoppage(
  batchNumber: string,
  payload: { categoryCode: string; breakdownCode?: string; remarks?: string },
) {
  return apiClient.post(`/6hi/orders/${enc(batchNumber)}/stoppages`, payload);
}

export function updateStoppage(
  batchNumber: string,
  stoppageId: string,
  payload: { categoryCode: string; breakdownCode?: string; remarks?: string },
) {
  return apiClient.patch(`/6hi/orders/${enc(batchNumber)}/stoppages/${enc(stoppageId)}`, payload);
}

export function endStoppage(batchNumber: string, stoppageId: string) {
  return apiClient.patch(`/6hi/orders/${enc(batchNumber)}/stoppages/${enc(stoppageId)}/end`, {});
}

export function rollChange(batchNumber: string, data: unknown) {
  return apiClient.post(`/6hi/orders/${enc(batchNumber)}/roll-change`, data);
}

export function allocateMachine(batchNumber: string, machineCode: string) {
  const url = `/6hi/orders/${enc(batchNumber)}/allocate-machine`;
  const payload = { machineCode };
  return withIdempotentWrite(orderAggregateKey(batchNumber), 'POST', url, payload, (headers) =>
    apiClient.post(url, payload, { headers }),
  );
}

export function transferMachines(machineCode: string, batchNumbers: string[]) {
  return apiClient.post('/6hi/orders/transfer-machines', { machineCode, batchNumbers });
}

export function transferOrderAssignment(
  payload: { batchNumbers: string[]; machineCode: string; reason?: string },
) {
  return apiClient.post<{ ok: boolean; results?: { batchNumber: string; ok: boolean; error?: string }[] }>(
    '/6hi/order-assignment/transfer',
    payload,
  );
}

export function createManualOrder(payload: unknown, machineCode: string) {
  void machineCode;
  return apiClient.post('/6hi/orders/manual', payload);
}

export function deleteOrder(batchNumber: string) {
  return apiClient.delete(`/6hi/orders/${enc(batchNumber)}`);
}

export function startManualStoppage(
  machine: string,
  payload: { categoryCode: string; breakdownCode?: string; remarks?: string },
) {
  return apiClient.post('/6hi/manual-stoppage/start', { machine, ...payload });
}

export function patchManualStoppage(machine: string, payload: Record<string, unknown>) {
  return apiClient.patch('/6hi/manual-stoppage', { machine, ...payload });
}

export function endManualStoppage(machine: string) {
  return apiClient.post('/6hi/manual-stoppage/end', { machine });
}
