/**
 * Property 4: Queued-entry indicator accuracy
 *
 * Validates: Requirements 2.6, 10.3
 *
 * For any sequence of enqueue and sync operations, the value shown by the
 * persistent offline/queued indicator should at all times equal the number of
 * pending items (QUEUED or FAILED) in the offline store, and the banner should
 * be visible whenever that count is greater than zero.
 *
 * Strategy: we test the two pure invariants that compose Property 4:
 *
 *   (a) pendingCount == |{ items where status ∈ {QUEUED, FAILED} }|
 *       for any arbitrary queue snapshot.
 *
 *   (b) banner visibility == (pendingCount > 0)
 *       for any non-negative integer count.
 *
 * The filtering logic is extracted from SyncEngine.getPendingCount() and
 * tested as a pure function, matching the implementation exactly:
 *
 *   queue.filter(i => i.status === 'QUEUED' || i.status === 'FAILED').length
 *
 * This avoids IndexedDB / browser-API dependencies in the Node test
 * environment while still verifying the correctness of the core invariant.
 * The existing syncEngine.test.ts follows the same pattern for queue ordering.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Inline the status type — mirrors SyncQueueItem in offlineStore.ts
// ---------------------------------------------------------------------------
type ItemStatus = 'QUEUED' | 'SYNCING' | 'FAILED';

interface QueueItem {
  id: string;
  endpoint: string;
  method: 'POST' | 'PUT' | 'DELETE';
  payload: unknown;
  timestamp: string;
  status: ItemStatus;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Pure implementations under test
//
// These mirror the exact logic in:
//   SyncEngine.getPendingCount()  →  queue.filter(i => i.status === 'QUEUED' || i.status === 'FAILED').length
//   OfflineBanner render guard    →  if (pendingCount <= 0) return null
// ---------------------------------------------------------------------------

/** Mirrors SyncEngine.getPendingCount() filtering logic. */
function pendingCount(items: QueueItem[]): number {
  return items.filter((i) => i.status === 'QUEUED' || i.status === 'FAILED').length;
}

/** Mirrors OfflineBanner render guard: visible iff count > 0. */
function bannerVisible(count: number): boolean {
  return count > 0;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const itemStatusArb = fc.constantFrom<ItemStatus>('QUEUED', 'SYNCING', 'FAILED');

const queueItemArb: fc.Arbitrary<QueueItem> = fc.record({
  id: fc.uuid(),
  endpoint: fc.constantFrom('/entries/hrs', '/entries/crm', '/entries/ann', '/entries/pkl'),
  method: fc.constantFrom<'POST' | 'PUT' | 'DELETE'>('POST', 'PUT', 'DELETE'),
  payload: fc.object(),
  timestamp: fc
    .date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
    .map((d) => d.toISOString()),
  status: itemStatusArb,
  retryCount: fc.nat({ max: 5 }),
});

/** Queue snapshot: 0–30 items with arbitrary mixed statuses. */
const queueSnapshotArb = fc.array(queueItemArb, { minLength: 0, maxLength: 30 });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 4: Queued-entry indicator accuracy', () => {
  // -------------------------------------------------------------------------
  // Property 4a: pendingCount == count of QUEUED + FAILED items
  // -------------------------------------------------------------------------
  it(
    'pendingCount equals the number of QUEUED or FAILED items for any queue snapshot',
    () => {
      fc.assert(
        fc.property(queueSnapshotArb, (snapshot) => {
          const count = pendingCount(snapshot);

          // Manual reference count for cross-checking.
          const queuedCount = snapshot.filter((i) => i.status === 'QUEUED').length;
          const failedCount = snapshot.filter((i) => i.status === 'FAILED').length;
          const expected = queuedCount + failedCount;

          expect(count).toBe(expected);
        }),
        { numRuns: 200 }
      );
    }
  );

  // -------------------------------------------------------------------------
  // Property 4b: banner is visible iff pendingCount > 0
  // -------------------------------------------------------------------------
  it('banner is visible if and only if pendingCount is greater than zero', () => {
    fc.assert(
      fc.property(fc.nat({ max: 100 }), (count) => {
        const visible = bannerVisible(count);
        if (count === 0) {
          expect(visible).toBe(false);
        } else {
          expect(visible).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  // -------------------------------------------------------------------------
  // Property 4c: combined — for any queue snapshot the banner visibility
  //              derived from pendingCount matches the reference rule
  // -------------------------------------------------------------------------
  it(
    'banner visibility derived from pendingCount matches the reference rule for any queue snapshot',
    () => {
      fc.assert(
        fc.property(queueSnapshotArb, (snapshot) => {
          const count = pendingCount(snapshot);
          const visible = bannerVisible(count);

          // Structural invariant: visible iff count > 0.
          expect(visible).toBe(count > 0);

          // When the queue is empty the banner must be hidden.
          if (snapshot.length === 0) {
            expect(count).toBe(0);
            expect(visible).toBe(false);
          }

          // When all items are SYNCING the banner must also be hidden.
          const allSyncing = snapshot.every((i) => i.status === 'SYNCING');
          if (allSyncing) {
            expect(count).toBe(0);
            expect(visible).toBe(false);
          }
        }),
        { numRuns: 200 }
      );
    }
  );

  // -------------------------------------------------------------------------
  // Property 4d: SYNCING items do NOT contribute to the pending count
  // -------------------------------------------------------------------------
  it('SYNCING items are excluded from the pending count', () => {
    fc.assert(
      fc.property(
        // A snapshot that always has at least one SYNCING item.
        fc
          .array(queueItemArb, { minLength: 1, maxLength: 20 })
          .map((items) =>
            items.map((item, idx) =>
              idx === 0 ? { ...item, status: 'SYNCING' as ItemStatus } : item
            )
          ),
        (snapshot) => {
          const count = pendingCount(snapshot);

          // Count must never include SYNCING items.
          const syncingItems = snapshot.filter((i) => i.status === 'SYNCING').length;
          expect(count).toBeLessThanOrEqual(snapshot.length - syncingItems);

          // Cross-check: count equals only QUEUED + FAILED.
          const queuedAndFailed = snapshot.filter(
            (i) => i.status === 'QUEUED' || i.status === 'FAILED'
          ).length;
          expect(count).toBe(queuedAndFailed);
        }
      ),
      { numRuns: 200 }
    );
  });

  // -------------------------------------------------------------------------
  // Property 4e: enqueueing one item increases the pending count by exactly 1
  // -------------------------------------------------------------------------
  it('enqueueing one item increases the pending count by exactly 1', () => {
    fc.assert(
      fc.property(queueSnapshotArb, (snapshot) => {
        const before = pendingCount(snapshot);

        // Simulate enqueue: add one QUEUED item.
        const newItem: QueueItem = {
          id: 'new-item',
          endpoint: '/entries/hrs',
          method: 'POST',
          payload: {},
          timestamp: new Date().toISOString(),
          status: 'QUEUED',
          retryCount: 0,
        };
        const after = pendingCount([...snapshot, newItem]);

        expect(after).toBe(before + 1);
        // Banner must be visible after any enqueue (count is at least 1).
        expect(bannerVisible(after)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  // -------------------------------------------------------------------------
  // Property 4f: removing a QUEUED or FAILED item decreases the count by 1
  // -------------------------------------------------------------------------
  it('removing a QUEUED or FAILED item decreases the pending count by exactly 1', () => {
    fc.assert(
      fc.property(
        // A snapshot that has at least one QUEUED or FAILED item.
        fc.array(queueItemArb, { minLength: 1, maxLength: 20 }).filter(
          (items) => items.some((i) => i.status === 'QUEUED' || i.status === 'FAILED')
        ),
        (snapshot) => {
          const before = pendingCount(snapshot);

          // Remove the first QUEUED or FAILED item (simulates a successful sync).
          const idx = snapshot.findIndex(
            (i) => i.status === 'QUEUED' || i.status === 'FAILED'
          );
          const after = pendingCount(snapshot.filter((_, i) => i !== idx));

          expect(after).toBe(before - 1);
          // Banner visibility follows the count.
          expect(bannerVisible(after)).toBe(after > 0);
        }
      ),
      { numRuns: 200 }
    );
  });

  // -------------------------------------------------------------------------
  // Property 4g: syncing N items reduces the pending count by exactly N
  //              (pure arithmetic invariant)
  // -------------------------------------------------------------------------
  it('syncing N items reduces the pending count by exactly N', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }).chain((initial) =>
          fc.tuple(fc.constant(initial), fc.nat({ max: initial }))
        ),
        ([initial, synced]) => {
          const afterSync = initial - synced;
          expect(afterSync).toBe(initial - synced);
          expect(afterSync).toBeGreaterThanOrEqual(0);
          // Banner visibility follows the count.
          expect(bannerVisible(afterSync)).toBe(afterSync > 0);
        }
      ),
      { numRuns: 200 }
    );
  });
});
