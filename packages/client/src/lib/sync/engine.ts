import { Network } from '@capacitor/network';
import { apiFetch } from '../apiClient';
import * as outbox from './outboxRepo';
import { invalidateAfterSyncedWrite } from './invalidateAfterWrite';
import { useSyncStatus } from './syncStatusStore';

const SYNC_INTERVAL_MS = 5 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let listenersStarted = false;

export interface SyncEngineOptions {
  afterPush?: () => Promise<void>;
}

async function pushOutbox() {
  for (const group of await outbox.nextBatch()) {
    for (const action of group) {
      try {
        const res = await apiFetch(action.url, {
          method: action.method,
          headers: { 'X-Idempotency-Key': action.id },
          ...(action.method === 'DELETE' ? {} : { body: action.payload }),
        });

        if (res.ok || res.status === 409) {
          await outbox.markSynced(action.id);
          invalidateAfterSyncedWrite(action.url);
          continue;
        }

        if (res.status >= 400 && res.status < 500) {
          await outbox.markParked(action.id, await res.text());
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
