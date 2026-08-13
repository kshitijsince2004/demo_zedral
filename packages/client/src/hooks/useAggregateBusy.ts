import { useSyncStatus } from '../lib/sync/syncStatusStore';

/** True while this aggregate has pending/parked/in-flight outbox rows. */
export function useAggregateBusy(aggregateKey: string): boolean {
  return useSyncStatus((s) => (s.pendingByAggregate[aggregateKey] ?? 0) > 0);
}
