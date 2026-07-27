/** Cross-module signal when capture/production data changes (invalidates live + report caches). */
export const PRODUCTION_SYNC_EVENT = 'zedral:production-changed';

export interface ProductionSyncDetail {
  shiftLogId?: string;
  batchNumber?: string;
}

const COALESCE_MS = 250;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDetail: ProductionSyncDetail | undefined;
const coordinatorListeners = new Set<() => void>();

function flushProductionSync(): void {
  coalesceTimer = null;
  trailingTimer = null;
  const detail = pendingDetail;
  pendingDetail = undefined;
  coordinatorListeners.forEach((handler) => handler());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PRODUCTION_SYNC_EVENT, { detail }));
  }
}

/** Coalesce refresh requests within a short window (trailing-edge flush). */
export function requestProductionSync(detail?: ProductionSyncDetail): void {
  if (detail) pendingDetail = { ...pendingDetail, ...detail };
  if (coalesceTimer) {
    if (trailingTimer) clearTimeout(trailingTimer);
    trailingTimer = setTimeout(flushProductionSync, COALESCE_MS);
    return;
  }
  coalesceTimer = setTimeout(flushProductionSync, COALESCE_MS);
}

export function subscribeProductionSync(handler: () => void): () => void {
  coordinatorListeners.add(handler);
  return () => coordinatorListeners.delete(handler);
}

export function notifyProductionChanged(detail?: ProductionSyncDetail): void {
  requestProductionSync(detail);
}

export function subscribeProductionChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = () => handler();
  window.addEventListener(PRODUCTION_SYNC_EVENT, listener);
  return () => window.removeEventListener(PRODUCTION_SYNC_EVENT, listener);
}
