import { apiClient } from '../apiClient';
import { submitOrQueue } from './submitOrQueue';

const OUTBOX_ENABLED = import.meta.env.VITE_OFFLINE_OUTBOX !== 'false';

export interface QueuedWriteResult<T> {
  queued: boolean;
  id: string;
  data?: T;
}

async function queueWrite<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  payload: unknown,
  aggregateKey: string,
): Promise<QueuedWriteResult<T>> {
  const { id, queued } = await submitOrQueue({ url, method, payload, aggregateKey });
  return { queued, id };
}

/** Route user-driven writes through the outbox when enabled; otherwise direct API. */
export async function postQueued<T>(
  url: string,
  payload: unknown,
  aggregateKey: string,
): Promise<QueuedWriteResult<T>> {
  if (!OUTBOX_ENABLED) {
    const data = await apiClient.post<T>(url, payload);
    return { queued: false, id: '', data };
  }
  return queueWrite<T>(url, 'POST', payload, aggregateKey);
}

export async function patchQueued<T>(
  url: string,
  payload: unknown,
  aggregateKey: string,
): Promise<QueuedWriteResult<T>> {
  if (!OUTBOX_ENABLED) {
    const data = await apiClient.patch<T>(url, payload);
    return { queued: false, id: '', data };
  }
  return queueWrite<T>(url, 'PATCH', payload, aggregateKey);
}

export async function putQueued<T>(
  url: string,
  payload: unknown,
  aggregateKey: string,
): Promise<QueuedWriteResult<T>> {
  if (!OUTBOX_ENABLED) {
    const data = await apiClient.put<T>(url, payload);
    return { queued: false, id: '', data };
  }
  return queueWrite<T>(url, 'PUT', payload, aggregateKey);
}

export async function deleteQueued<T>(
  url: string,
  aggregateKey: string,
): Promise<QueuedWriteResult<T>> {
  if (!OUTBOX_ENABLED) {
    const data = await apiClient.delete<T>(url);
    return { queued: false, id: '', data };
  }
  return queueWrite<T>(url, 'DELETE', {}, aggregateKey);
}
