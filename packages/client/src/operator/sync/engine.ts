import { Network } from '@capacitor/network';
import { apiFetch } from '../../lib/apiClient';
import * as outbox from '../db/outboxRepo';
import { pullMasters, pullPlan } from './pull';
import { useSyncStatus } from './syncStatusStore';

const SYNC_INTERVAL_MS = 5 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let listenersStarted = false;

export function startSyncEngine() {
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
    await pullMasters();
    await pullPlan();
    await outbox.pruneSynced();
    status.set({ lastSuccessAt: Date.now() });
  } finally {
    const counts = await outbox.counts();
    status.set({ isSyncing: false, ...counts });
  }
}

async function pushOutbox() {
  for (const group of await outbox.nextBatch()) {
    for (const action of group) {
      try {
        const res = await apiFetch(action.url, {
          method: action.method,
          headers: { 'X-Idempotency-Key': action.id },
          body: action.payload,
        });

        if (res.ok || res.status === 409) {
          await outbox.markSynced(action.id);
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
