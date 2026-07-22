import { notifyProductionChanged, type ProductionSyncDetail } from '../productionSync';

const CACHE_RELEVANT_URL = /^\/(6hi|production|shift-logs|machines\/handover|machine-crew|machine-access)/;

export function shouldInvalidateCachesForUrl(url: string): boolean {
  return CACHE_RELEVANT_URL.test(url);
}

export function invalidateAfterWrite(detail?: ProductionSyncDetail): void {
  notifyProductionChanged(detail);
}

export function invalidateAfterSyncedWrite(url: string, detail?: ProductionSyncDetail): void {
  if (shouldInvalidateCachesForUrl(url)) {
    notifyProductionChanged(detail);
  }
}