import type { QueueItem } from '../services/machineHandoverService';

type QueueBuckets = {
  rolling?: QueueItem[];
  skinpass?: QueueItem[];
  pendingAllocation?: QueueItem[];
  backlogRolling?: QueueItem[];
  backlogSkinpass?: QueueItem[];
};

/** Merge handover queue buckets for display, deduped by batch number. */
export function flattenHandoverQueue(queue: QueueBuckets, limit = 10): QueueItem[] {
  const seen = new Set<string>();
  const merged: QueueItem[] = [];
  const buckets = [
    queue.rolling,
    queue.skinpass,
    queue.pendingAllocation,
    queue.backlogRolling,
    queue.backlogSkinpass,
  ];

  for (const bucket of buckets) {
    for (const item of bucket ?? []) {
      if (seen.has(item.batchNumber)) continue;
      seen.add(item.batchNumber);
      merged.push(item);
      if (merged.length >= limit) return merged;
    }
  }

  return merged;
}
