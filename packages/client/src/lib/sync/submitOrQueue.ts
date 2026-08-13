import { Capacitor } from '@capacitor/core';
import { agentDebugLog, isHrsDebugPath } from '../agentDebugLog';
import { useAuthStore } from '../authStore';
import { newId } from '../newId';
import { canWriteMachine } from '../machineRouting';
import { ApiError } from '../apiClient';
import { computeIdempotencyKey, markTapLock } from '../idempotencyKey';
import * as outbox from './outboxRepo';
import { machineCodeFromOutboxUrl } from './outboxPolicy';
import { syncNow } from './engine';
import { useSyncStatus } from './syncStatusStore';
import { offlineReadyPromise } from '../../operator/native/init';

function outboxDedupEnabled(): boolean {
  try {
    return import.meta.env.VITE_OUTBOX_DEDUP !== 'false';
  } catch {
    return true;
  }
}

export async function submitOrQueue(opts: {
  url: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  payload: unknown;
  aggregateKey: string;
}): Promise<{ queued: boolean; id: string }> {
  // APK only: wait for initDb() so the write lands in SQLite, not IndexedDB
  // before SQLCipher is ready. Web main never calls initNative — don't hang.
  if (Capacitor.isNativePlatform()) {
    await offlineReadyPromise;
  }
  const mill = machineCodeFromOutboxUrl(opts.url);
  if (mill) {
    const { role, machineAccess } = useAuthStore.getState();
    // Never enqueue Forbidden mill writes (e.g. handover:4HI/session for a 6HI-only user).
    if (!canWriteMachine(role, machineAccess, mill)) {
      throw new ApiError(`No write access for machine ${mill}`, 403, { error: 'FORBIDDEN_MACHINE' });
    }
  }

  const idempotencyKey = await computeIdempotencyKey({
    aggregateKey: opts.aggregateKey,
    method: opts.method,
    url: opts.url,
    payload: opts.payload,
  });

  if (outboxDedupEnabled()) {
    markTapLock(opts.aggregateKey);
  }

  const id = newId();
  const row = await outbox.enqueue({
    id,
    ...opts,
    idempotencyKey: outboxDedupEnabled() ? idempotencyKey : undefined,
  });

  const pendingByAggregate = {
    ...useSyncStatus.getState().pendingByAggregate,
    [opts.aggregateKey]: (useSyncStatus.getState().pendingByAggregate[opts.aggregateKey] ?? 0) + (row.id === id ? 1 : 0),
  };
  if (row.id === id) {
    const { pending, parked } = useSyncStatus.getState();
    useSyncStatus.getState().set({
      pending: pending + 1,
      parked,
      pendingByAggregate,
    });
  }

  void syncNow('submit');

  if (isHrsDebugPath(opts.url)) {
    agentDebugLog('submitOrQueue.ts', 'HRS write enqueued', {
      url: opts.url,
      method: opts.method,
      aggregateKey: opts.aggregateKey,
      rowId: row.id,
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      isNative: Capacitor.isNativePlatform(),
    }, 'C');
  }

  return {
    id: row.id,
    queued: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  };
}
