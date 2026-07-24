import { Network } from '@capacitor/network';
import { apiFetch } from '../apiClient';
import { useAuthStore } from '../authStore';
import { getWriteMachineAccess } from '../machineRouting';
import * as outbox from './outboxRepo';
import { isBenignSyncClientError } from './outboxPolicy';
import { invalidateAfterSyncedWrite } from './invalidateAfterWrite';
import { useSyncStatus } from './syncStatusStore';

const SYNC_INTERVAL_MS = 5 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let listenersStarted = false;

export interface SyncEngineOptions {
  afterPush?: () => Promise<void>;
}

async function pushOutbox() {
  // Drop Forbidden / wrong-mill rows before replay (e.g. handover:4HI for 6HI-only JWT).
  const { role, machineAccess } = useAuthStore.getState();
  await outbox.discardInaccessibleMachineActions(getWriteMachineAccess(role, machineAccess));
  await outbox.reconcileBenignParked(isBenignSyncClientError);

  for (const group of await outbox.nextBatch()) {
    for (const action of group) {
      try {
        const res = await apiFetch(action.url, {
          method: action.method,
          headers: { 'X-Idempotency-Key': action.id },
          skipAuthLogout: true,
          ...(action.method === 'DELETE' ? {} : { body: action.payload }),
        });

        if (res.ok || res.status === 409) {
          await outbox.markSynced(action.id);
          invalidateAfterSyncedWrite(action.url);
          continue;
        }

        if (res.status >= 400 && res.status < 500) {
          const body = await res.text();
          if (isBenignSyncClientError(res.status, body)) {
            await outbox.markSynced(action.id);
            continue;
          }
          // Auth expired mid-sync — keep pending so login can retry (do not park forever).
          if (res.status === 401) {
            await outbox.bumpAttempt(action.id, body || 'HTTP 401');
            break;
          }
          await outbox.markParked(action.id, body);
          break;
        }

        await outbox.bumpAttempt(action.id, `HTTP ${res.status}`);
        break;
      } catch (error) {
        await outbox.bumpAttempt(action.id, error instanceof Error ? error.message : String(error));
        break;
      }
    }
  }
}

let engineOptions: SyncEngineOptions = {};

export function startSyncEngine(options: SyncEngineOptions = {}) {
  engineOptions = options;

  if (!listenersStarted) {
    listenersStarted = true;
    void Network.addListener('networkStatusChange', (status) => {
      if (status.connected) void syncNow('reconnect');
    });
  }

  if (!timer) {
    timer = setInterval(() => void syncNow('interval'), SYNC_INTERVAL_MS);
  }

  void syncNow('boot');
}

export async function syncNow(reason: string): Promise<void> {
  const status = useSyncStatus.getState();
  if (status.isSyncing) return;

  status.set({ isSyncing: true, lastReason: reason });

  try {
    await pushOutbox();
    if (engineOptions.afterPush) {
      await engineOptions.afterPush();
    }
    await outbox.pruneSynced();
    status.set({ lastSuccessAt: Date.now() });
  } finally {
    const queueCounts = await outbox.counts();
    status.set({ isSyncing: false, ...queueCounts });
  }
}
