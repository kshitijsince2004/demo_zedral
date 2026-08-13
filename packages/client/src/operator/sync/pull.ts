import { get, set } from 'idb-keyval';
import { apiClient, ApiError } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
import { getDb, hasNativeDb } from '../db/sqlite';

interface DeltaResponse {
  rows?: Record<string, unknown>[];
  serverTime?: string;
}

const WEB_MASTER_KEY = 'm1operator:master-cache';
const WEB_PLAN_KEY = 'm1operator:plan-cache';
const WEB_META_KEY = 'm1operator:sync-meta';

async function getMeta(key: string): Promise<string | null> {
  if (!hasNativeDb()) {
    const meta = (await get<Record<string, string>>(WEB_META_KEY)) ?? {};
    return meta[key] ?? null;
  }

  const result = await getDb().query('SELECT v FROM sync_meta WHERE k = ?', [key]);
  return typeof result.values?.[0]?.v === 'string' ? result.values[0].v : null;
}

async function setMeta(key: string, value: string): Promise<void> {
  if (!hasNativeDb()) {
    const meta = (await get<Record<string, string>>(WEB_META_KEY)) ?? {};
    meta[key] = value;
    await set(WEB_META_KEY, meta);
    return;
  }

  await getDb().run(
    'INSERT OR REPLACE INTO sync_meta (k, v) VALUES (?, ?)',
    [key, value],
  );
}

async function cacheMasters(rows: Record<string, unknown>[]): Promise<void> {
  if (!hasNativeDb()) {
    await set(WEB_MASTER_KEY, rows);
    return;
  }

  const now = Date.now();
  const batch = rows.flatMap((row) => {
    const tableName = String(row.tableName ?? row.table_name ?? row.entityType ?? 'master');
    const rowId = String(row.id ?? row.code ?? row.rowId ?? row.row_id);
    if (!rowId || rowId === 'undefined') return [];
    return [{
      statement: `INSERT OR REPLACE INTO master_cache (table_name, row_id, data, updated_at) VALUES (?, ?, ?, ?)`,
      values: [tableName, rowId, JSON.stringify(row), now],
    }];
  });
  if (batch.length) await getDb().executeSet(batch);
}

async function cachePlan(rows: Record<string, unknown>[]): Promise<void> {
  if (!hasNativeDb()) {
    await set(WEB_PLAN_KEY, rows);
    return;
  }

  const now = Date.now();
  const batch = rows.flatMap((row) => {
    const coilNo = String(row.coilNo ?? row.coil_no ?? row.batchNumber ?? row.batch_number);
    if (!coilNo || coilNo === 'undefined') return [];
    return [{
      statement: `INSERT OR REPLACE INTO plan_cache (coil_no, data, updated_at) VALUES (?, ?, ?)`,
      values: [coilNo, JSON.stringify(row), now],
    }];
  });
  if (batch.length) await getDb().executeSet(batch);
}

function isUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.isOffline || error.status === 404);
}

export async function pullMasters(): Promise<void> {
  const since = await getMeta('masters_since');
  const suffix = since ? `?since=${encodeURIComponent(since)}` : '';

  try {
    const response = await apiClient.get<DeltaResponse>(`/master-data/delta${suffix}`);
    await cacheMasters(response.rows ?? []);
    if (response.serverTime) await setMeta('masters_since', response.serverTime);
  } catch (error) {
    if (!isUnavailable(error)) throw error;
  }
}

export async function pullPlan(): Promise<void> {
  const state = useAuthStore.getState();
  const lineCode = state.activeMachine ?? state.lineAccess[0];
  if (!lineCode) return;

  const since = await getMeta(`plan_since:${lineCode}`);
  const params = new URLSearchParams({ line: lineCode });
  if (since) params.set('since', since);

  try {
    const response = await apiClient.get<DeltaResponse>(`/planned-coils/delta?${params.toString()}`);
    await cachePlan(response.rows ?? []);
    if (response.serverTime) await setMeta(`plan_since:${lineCode}`, response.serverTime);
  } catch (error) {
    if (!isUnavailable(error)) throw error;
  }
}

/**
 * PERF-C4 — warm plan + masters at login / shift-start so the first screen paints from cache.
 * Login, engine start, and shift-detection can all call this within moments of each other —
 * dedupe to a single in-flight run instead of firing duplicate delta pulls.
 */
let inflightPrefetch: Promise<void> | null = null;
export function prefetchOperatorCaches(): Promise<void> {
  if (!inflightPrefetch) {
    inflightPrefetch = Promise.allSettled([pullMasters(), pullPlan()])
      .then(() => undefined)
      .finally(() => {
        inflightPrefetch = null;
      });
  }
  return inflightPrefetch;
}

export async function cachedGet<T>(url: string, cacheKey: string): Promise<T> {
  try {
    return await apiClient.get<T>(url);
  } catch (error) {
    if (!isUnavailable(error)) throw error;
    return (await get<T>(cacheKey)) as T;
  }
}
