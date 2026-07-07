/** Cross-module signal when capture/production data changes (invalidates live + report caches). */
export const PRODUCTION_SYNC_EVENT = 'zedral:production-changed';

export interface ProductionSyncDetail {
  shiftLogId?: string;
  batchNumber?: string;
}

export function notifyProductionChanged(detail?: ProductionSyncDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PRODUCTION_SYNC_EVENT, { detail }));
}

export function subscribeProductionChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = () => handler();
  window.addEventListener(PRODUCTION_SYNC_EVENT, listener);
  return () => window.removeEventListener(PRODUCTION_SYNC_EVENT, listener);
}
