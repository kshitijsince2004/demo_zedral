import { Network } from '@capacitor/network';
import { agentDebugLog, isHrsDebugPath } from '../agentDebugLog';
import { apiFetch } from '../apiClient';
import { useAuthStore } from '../authStore';
import { getWriteMachineAccess } from '../machineRouting';
import * as outbox from './outboxRepo';
import { isBenignSyncClientError } from './outboxPolicy';
import { invalidateAfterSyncedWrite } from './invalidateAfterWrite';
import { useSyncStatus } from './syncStatusStore';

const SYNC_INTERVAL_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_FACTOR = 3;

/** Opt-out: set VITE_SYNC_BATCH=false to force sequential outbox replay. */
function syncBatchEnabled(): boolean {
  try {
    return import.meta.env.VITE_SYNC_BATCH !== 'false';
  } catch {
    return true;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let listenersStarted = false;
/** Consecutive transient bumpAttempt streak for jittered backoff. */
let failStreak = 0;

export interface SyncEngineOptions {
  afterPush?: () => Promise<void>;
}

async function hasSession(): Promise<boolean> {
  try {
    const Session = (await import('supertokens-auth-react/recipe/session')).default;
    // await so rejected doesSessionExist (uninit ST) hits catch — not an unhandled rejection
    return await Session.doesSessionExist();
  } catch {
    return false;
  }
}

function clearBackoff() {
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

/** Jittered exponential: 5s, 15s, 45s… capped at SYNC_INTERVAL_MS. */
function scheduleBackoffRetry() {
  failStreak += 1;
  const exp = Math.min(failStreak - 1, 8);
  const base = Math.min(BACKOFF_BASE_MS * BACKOFF_FACTOR ** exp, SYNC_INTERVAL_MS);
  const delay = Math.round(base * (0.5 + Math.random()));
  clearBackoff();
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    void syncNow('backoff');
  }, delay);
}

type BatchItemResult = { id: string; status: number; body?: unknown; skipped?: boolean };

async function applyActionResult(
  action: outbox.OutboxAction,
  status: number,
  bodyText: string,
): Promise<'ok' | 'park' | 'transient' | 'auth'> {
  if (status === 0 || status >= 500) {
    await outbox.bumpAttempt(action.id, bodyText || `HTTP ${status}`);
    return 'transient';
  }
  if (status === 409 || (status >= 200 && status < 300)) {
    await outbox.markSynced(action.id);
    invalidateAfterSyncedWrite(action.url);
    return 'ok';
  }
  if (status >= 400 && status < 500) {
    if (isBenignSyncClientError(status, bodyText)) {
      await outbox.markSynced(action.id);
      return 'ok';
    }
    if (status === 401) {
      await outbox.bumpAttempt(action.id, bodyText || 'HTTP 401');
      return 'auth';
    }
    await outbox.markParked(action.id, bodyText);
    console.info('[outbox] parked', {
      url: action.url,
      method: action.method,
      status,
      aggregateKey: action.aggregateKey,
      id: action.id,
    });
    if (isHrsDebugPath(action.url)) {
      agentDebugLog('engine.ts:applyActionResult', 'HRS outbox parked', {
        url: action.url,
        method: action.method,
        status,
        aggregateKey: action.aggregateKey,
        bodyPreview: bodyText.slice(0, 200),
      }, 'C');
    }
    return 'park';
  }
  await outbox.bumpAttempt(action.id, bodyText || `HTTP ${status}`);
  return 'transient';
}

async function pushOutboxSequential(groups: outbox.OutboxAction[][]): Promise<'ok' | 'transient'> {
  let hadTransient = false;

  for (const group of groups) {
    for (const action of group) {
      try {
        const res = await apiFetch(action.url, {
          method: action.method,
          headers: { 'X-Idempotency-Key': action.idempotencyKey ?? action.id },
          skipAuthLogout: true,
          ...(action.method === 'DELETE' ? {} : { body: action.payload }),
        });

        const body = res.ok || res.status === 409 ? '' : await res.text();
        const outcome = await applyActionResult(action, res.status, body);
        if (isHrsDebugPath(action.url)) {
          agentDebugLog('engine.ts:pushOutboxSequential', 'HRS outbox replay', {
            url: action.url,
            method: action.method,
            status: res.status,
            outcome,
          }, outcome === 'auth' ? 'B' : 'C');
        }
        if (outcome === 'ok') continue;
        if (outcome === 'transient' || outcome === 'auth') {
          hadTransient = true;
          break;
        }
        // parked — stop this aggregate
        break;
      } catch (error) {
        await outbox.bumpAttempt(action.id, error instanceof Error ? error.message : String(error));
        hadTransient = true;
        break;
      }
    }
    if (hadTransient) break;
  }

  return hadTransient ? 'transient' : 'ok';
}

async function pushOutboxBatch(groups: outbox.OutboxAction[][]): Promise<'ok' | 'transient' | 'fallback'> {
  const flat = groups.flat();
  if (flat.length === 0) return 'ok';

  try {
    const res = await apiFetch('/sync/batch', {
      method: 'POST',
      skipAuthLogout: true,
      body: JSON.stringify({
        items: flat.map((a) => ({
          id: a.id,
          method: a.method,
          url: a.url,
          aggregateKey: a.aggregateKey,
          idempotencyKey: a.idempotencyKey ?? a.id,
          payload: a.method === 'DELETE' ? undefined : (() => {
            try {
              return JSON.parse(a.payload);
            } catch {
              return a.payload;
            }
          })(),
        })),
      }),
    });

    if (res.status === 404 || res.status === 501) return 'fallback';
    if (!res.ok) {
      // Whole-batch transport failure — try sequential so individual items still drain.
      return 'fallback';
    }

    const data = (await res.json()) as { results?: BatchItemResult[] };
    const results = data.results ?? [];
    const byId = new Map(results.map((r) => [r.id, r]));

    let hadTransient = false;

    for (const action of flat) {
      const result = byId.get(action.id);
      if (!result) {
        await outbox.bumpAttempt(action.id, 'Missing batch result');
        hadTransient = true;
        continue;
      }

      // Server skipped due to prior failure in aggregate / transient — leave pending.
      if (result.skipped || result.status === 0) {
        if (result.body && typeof result.body === 'object' && (result.body as { reason?: string }).reason === 'prior_transient') {
          hadTransient = true;
        }
        continue;
      }

      const bodyText =
        result.body == null
          ? ''
          : typeof result.body === 'string'
            ? result.body
            : JSON.stringify(result.body);

      const outcome = await applyActionResult(action, result.status, bodyText);
      if (isHrsDebugPath(action.url)) {
        agentDebugLog('engine.ts:pushOutboxBatch', 'HRS batch item result', {
          url: action.url,
          method: action.method,
          status: result.status,
          skipped: result.skipped ?? false,
          outcome,
          bodyPreview: bodyText.slice(0, 200),
        }, outcome === 'auth' ? 'B' : 'C');
      }
      if (outcome === 'transient' || outcome === 'auth') hadTransient = true;
    }

    return hadTransient ? 'transient' : 'ok';
  } catch {
    return 'fallback';
  }
}

async function pushOutboxPage(groups: outbox.OutboxAction[][]): Promise<'ok' | 'transient'> {
  if (syncBatchEnabled()) {
    const batchResult = await pushOutboxBatch(groups);
    if (batchResult === 'ok') return 'ok';
    // Batch loopback can fail (503) while sequential /api replay still works via dev proxy.
    return pushOutboxSequential(groups);
  }
  return pushOutboxSequential(groups);
}

async function pushOutbox(): Promise<'ok' | 'transient'> {
  // Boot/interval can run before login — don't spam /api with bare 401s.
  if (!(await hasSession())) return 'ok';

  // Drop Forbidden / wrong-mill rows before replay (e.g. handover:4HI for 6HI-only JWT).
  const { role, machineAccess } = useAuthStore.getState();
  await outbox.discardInaccessibleMachineActions(getWriteMachineAccess(role, machineAccess));
  await outbox.reconcileBenignParked(isBenignSyncClientError);

  // Drain full native pages (LIMIT 200) in one syncNow so long offline shifts catch up.
  let prevHead: string | null = null;
  for (;;) {
    const groups = await outbox.nextBatch();
    const flat = groups.flat();
    if (flat.length === 0) return 'ok';

    const head = flat[0]!.id;
    // Same head as last round → no progress (e.g. parked stuck); stop.
    if (head === prevHead) return 'ok';
    prevHead = head;

    const result = await pushOutboxPage(groups);
    if (result === 'transient') return 'transient';
    if (flat.length < outbox.OUTBOX_BATCH_LIMIT) return 'ok';
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
    const result = await pushOutbox();
    if (engineOptions.afterPush) {
      await engineOptions.afterPush();
    }
    await outbox.pruneSynced();
    status.set({ lastSuccessAt: Date.now() });

    if (result === 'transient') {
      scheduleBackoffRetry();
    } else {
      failStreak = 0;
      clearBackoff();
    }
  } finally {
    const queueCounts = await outbox.counts();
    const pendingByAggregate = await outbox.pendingByAggregate();
    status.set({ isSyncing: false, ...queueCounts, pendingByAggregate });
    if (queueCounts.pending > 0 || queueCounts.parked > 0) {
      agentDebugLog('engine.ts:syncNow', 'outbox counts after sync', {
        reason,
        pending: queueCounts.pending,
        parked: queueCounts.parked,
        aggregates: Object.keys(pendingByAggregate).filter((k) => k.includes('capture') || k.toLowerCase().includes('hrs')),
      }, 'C');
    }
  }
}
