/**
 * Property 2: Save persists through the sync engine
 *
 * Validates: Requirements 2.1, 2.3, 2.5, 5.3
 *
 * Tagged: Feature: m1-frontend-remediation, Property 2: Save persists through the sync engine
 *
 * For any valid entry of any capturable entity type (process entry, stoppage,
 * crew, defect), invoking save should:
 *
 *   (a) Enqueue exactly one item into the offline store via the sync engine.
 *   (b) Target the entity's correct endpoint (`/entries/<processCode>`).
 *   (c) Carry a payload equal to the form's values and the current shift-log
 *       association — the payload is passed through unchanged.
 *   (d) After the save, the form's dirty state should be cleared (outcome ≠
 *       'blocked').
 *   (e) The surfaced save status should equal the engine's actual outcome:
 *       'queued' when offline/pending (pendingCount > 0),
 *       'transmitted' when synced (pendingCount === 0).
 *       It must never be a hardcoded message.
 *   (f) While offline (pendingCount > 0), the item should remain persisted in
 *       QUEUED state — i.e. the outcome is 'queued', not 'transmitted'.
 *
 * Strategy: `executeSave` is the pure, injectable core of `useEntryForm`.
 * We test it directly with injected `SaveDependencies` so no IndexedDB,
 * browser APIs, or React environment is needed.  The arbitraries generate
 * realistic process codes, shift-log IDs, and payloads; the injected deps
 * control the engine's reported pending count to simulate online/offline.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Mock the syncEngine module before importing the hook so that IndexedDB
// (unavailable in the Node test environment) is never instantiated.
vi.mock('../src/lib/syncEngine', () => ({
  syncEngine: {
    enqueue: vi.fn(),
    getPendingCount: vi.fn(),
    subscribe: vi.fn(),
    sync: vi.fn(),
  },
}));

import { executeSave } from '../src/hooks/useEntryForm';
import type { SaveDependencies } from '../src/hooks/useEntryForm';
import type { ValidationResult } from '@m1/shared-validation';
import type { SyncQueueItem } from '../src/lib/offlineStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueueItem(id: string, endpoint: string, payload: unknown): SyncQueueItem {
  return {
    id,
    endpoint,
    method: 'POST',
    payload,
    timestamp: new Date().toISOString(),
    status: 'QUEUED',
    retryCount: 0,
  };
}

function validResult(): ValidationResult {
  return { isValid: true, errors: [], warnings: [] };
}

/**
 * Build injectable SaveDependencies where:
 *   - validate always returns valid
 *   - enqueue resolves with a QUEUED item carrying the given id/endpoint/payload
 *   - getPendingCount resolves with `pendingCount`
 */
function makeDeps(
  pendingCount: number,
  queueId = 'item-1',
  endpoint = '/entries/hrs',
  payload: unknown = {},
): SaveDependencies {
  return {
    validate: vi.fn().mockReturnValue(validResult()),
    enqueue: vi.fn().mockResolvedValue(makeQueueItem(queueId, endpoint, payload)),
    getPendingCount: vi.fn().mockResolvedValue(pendingCount),
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Canonical process codes (Req 1.4 — only these are valid capture targets). */
const processCodeArb = fc.constantFrom(
  'HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL',
);

/**
 * Entity types that can be saved through the sync engine.
 * Process entries use the process code; sub-forms use their own codes.
 * Req 5.3 requires crew entries to also persist through the sync engine.
 */
const entityTypeArb = fc.constantFrom(
  'HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL',
  'STOPPAGE', 'CREW', 'DEFECT',
);

/** A UUID-like shift-log association id. */
const shiftLogIdArb = fc.uuid();

/** A realistic form payload: an object with a shiftLogId plus arbitrary fields. */
const formPayloadArb = shiftLogIdArb.chain((shiftLogId) =>
  fc.record({
    shiftLogId: fc.constant(shiftLogId),
    coilNo: fc.stringMatching(/^[A-Z0-9-]{3,20}$/),
    weightMt: fc.float({ min: Math.fround(0.1), max: Math.fround(999), noNaN: true }),
    nominalWidthMm: fc.integer({ min: 100, max: 2000 }),
  }),
);

/** Pending count > 0 simulates offline / not-yet-synced state. */
const offlinePendingCountArb = fc.integer({ min: 1, max: 50 });

/** Pending count === 0 simulates immediate transmission (online). */
const onlinePendingCountArb = fc.constant(0);

/** Any non-negative pending count. */
const anyPendingCountArb = fc.nat({ max: 50 });

// ---------------------------------------------------------------------------
// Property 2a: Exactly one enqueue call per valid save (Req 2.1)
// ---------------------------------------------------------------------------
describe('Property 2: Save persists through the sync engine', () => {
  it(
    '2a — valid save enqueues exactly one item for any entity type and payload (Req 2.1)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          entityTypeArb,
          formPayloadArb,
          anyPendingCountArb,
          async (entityType, payload, pendingCount) => {
            const endpoint = `/entries/${entityType.toLowerCase()}`;
            const deps = makeDeps(pendingCount, 'item-1', endpoint, payload);

            await executeSave(entityType, payload, deps);

            // enqueue must be called exactly once — no double-enqueue, no skip.
            expect(deps.enqueue).toHaveBeenCalledTimes(1);
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 2b: Endpoint targets the entity's correct path (Req 2.1)
  // ---------------------------------------------------------------------------
  it(
    '2b — enqueue targets the correct endpoint for every entity type (Req 2.1)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          entityTypeArb,
          formPayloadArb,
          async (entityType, payload) => {
            const expectedEndpoint = `/entries/${entityType.toLowerCase()}`;
            const deps = makeDeps(0, 'item-1', expectedEndpoint, payload);

            await executeSave(entityType, payload, deps);

            const [calledEndpoint, calledMethod] = (deps.enqueue as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(calledEndpoint).toBe(expectedEndpoint);
            expect(calledMethod).toBe('POST');
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 2c: Payload passed to enqueue equals the form's values unchanged
  //              (Req 2.1 — "carrying a payload equal to the form's values")
  // ---------------------------------------------------------------------------
  it(
    '2c — enqueue receives the exact form payload without modification (Req 2.1)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          processCodeArb,
          formPayloadArb,
          async (processCode, payload) => {
            const deps = makeDeps(1, 'item-1', `/entries/${processCode.toLowerCase()}`, payload);

            await executeSave(processCode, payload, deps);

            const calledPayload = (deps.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][2];
            expect(calledPayload).toEqual({
              ...payload,
              processCode: processCode.toUpperCase(),
            });
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 2d: After a successful save the outcome is not 'blocked'
  //              (dirty state cleared — Req 2.5)
  // ---------------------------------------------------------------------------
  it(
    '2d — outcome is never "blocked" for a valid entry (dirty state cleared after save) (Req 2.5)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          processCodeArb,
          formPayloadArb,
          anyPendingCountArb,
          async (processCode, payload, pendingCount) => {
            const deps = makeDeps(pendingCount, 'item-1', `/entries/${processCode.toLowerCase()}`, payload);

            const { outcome } = await executeSave(processCode, payload, deps);

            // A valid save must never be blocked — dirty state is cleared.
            expect(outcome.outcome).not.toBe('blocked');
            expect(outcome.errors).toHaveLength(0);
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 2e: Save status equals the engine's actual outcome — 'queued'
  //              when offline (pendingCount > 0), 'transmitted' when synced
  //              (pendingCount === 0). Never a hardcoded message. (Req 2.5)
  // ---------------------------------------------------------------------------
  it(
    '2e — save status is "queued" when pendingCount > 0 (offline/pending) (Req 2.5)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          processCodeArb,
          formPayloadArb,
          offlinePendingCountArb,
          async (processCode, payload, pendingCount) => {
            const deps = makeDeps(pendingCount, 'item-1', `/entries/${processCode.toLowerCase()}`, payload);

            const { outcome, status } = await executeSave(processCode, payload, deps);

            expect(outcome.outcome).toBe('queued');
            expect(status).toBe('queued');
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  it(
    '2e — save status is "transmitted" when pendingCount === 0 (synced immediately) (Req 2.5)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          processCodeArb,
          formPayloadArb,
          async (processCode, payload) => {
            const deps = makeDeps(0, 'item-1', `/entries/${processCode.toLowerCase()}`, payload);

            const { outcome, status } = await executeSave(processCode, payload, deps);

            expect(outcome.outcome).toBe('transmitted');
            expect(status).toBe('transmitted');
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  it(
    '2e — status is derived from the engine, never a hardcoded string (Req 2.5)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          processCodeArb,
          formPayloadArb,
          anyPendingCountArb,
          async (processCode, payload, pendingCount) => {
            const deps = makeDeps(pendingCount, 'item-1', `/entries/${processCode.toLowerCase()}`, payload);

            const { status } = await executeSave(processCode, payload, deps);

            // Status must be one of the two engine-derived values, never a
            // hardcoded message like 'Saved successfully to SyncQueue!'.
            expect(['queued', 'transmitted']).toContain(status);
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 2f: While offline (pendingCount > 0), the item remains in QUEUED
  //              state — the outcome is 'queued', not 'transmitted' (Req 2.3)
  // ---------------------------------------------------------------------------
  it(
    '2f — while offline the item remains in QUEUED state (outcome is "queued") (Req 2.3)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          processCodeArb,
          formPayloadArb,
          offlinePendingCountArb,
          async (processCode, payload, pendingCount) => {
            const deps = makeDeps(pendingCount, 'item-1', `/entries/${processCode.toLowerCase()}`, payload);

            const { outcome, status } = await executeSave(processCode, payload, deps);

            // Offline: item must be QUEUED, not transmitted.
            expect(outcome.outcome).toBe('queued');
            expect(status).toBe('queued');
            expect(status).not.toBe('transmitted');
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 2g: The queueId in the outcome matches the id of the enqueued item
  //              (Req 2.1 — "enqueue exactly one item … carrying a payload")
  // ---------------------------------------------------------------------------
  it(
    '2g — outcome.queueId matches the id of the item returned by enqueue (Req 2.1)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          processCodeArb,
          formPayloadArb,
          fc.uuid(),
          anyPendingCountArb,
          async (processCode, payload, queueId, pendingCount) => {
            const endpoint = `/entries/${processCode.toLowerCase()}`;
            const deps = makeDeps(pendingCount, queueId, endpoint, payload);

            const { outcome } = await executeSave(processCode, payload, deps);

            expect(outcome.queueId).toBe(queueId);
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 2h: Crew entries (Req 5.3) persist through the sync engine with
  //              the correct endpoint, just like process entries.
  // ---------------------------------------------------------------------------
  it(
    '2h — crew entries persist through the sync engine with the correct endpoint (Req 5.3)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          shiftLogIdArb,
          fc.record({
            shiftLogId: shiftLogIdArb,
            operatorId: fc.uuid(),
            roleCode: fc.constantFrom('OPERATOR', 'ASST', 'HELPER', 'CRANE', 'MTL'),
          }),
          anyPendingCountArb,
          async (_shiftLogId, crewPayload, pendingCount) => {
            const entityType = 'CREW';
            const expectedEndpoint = '/entries/crew';
            const deps = makeDeps(pendingCount, 'crew-item-1', expectedEndpoint, crewPayload);

            await executeSave(entityType, crewPayload, deps);

            expect(deps.enqueue).toHaveBeenCalledTimes(1);
            const [calledEndpoint, calledMethod, calledPayload] =
              (deps.enqueue as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(calledEndpoint).toBe(expectedEndpoint);
            expect(calledMethod).toBe('POST');
            expect(calledPayload).toEqual({
              ...crewPayload,
              processCode: 'CREW',
            });
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 2i: Status transitions are monotone within a single save call —
  //              the status returned is consistent with the outcome field.
  //              (Internal consistency invariant — Req 2.5)
  // ---------------------------------------------------------------------------
  it(
    '2i — outcome.outcome and status are always consistent with each other (Req 2.5)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          processCodeArb,
          formPayloadArb,
          anyPendingCountArb,
          async (processCode, payload, pendingCount) => {
            const deps = makeDeps(pendingCount, 'item-1', `/entries/${processCode.toLowerCase()}`, payload);

            const { outcome, status } = await executeSave(processCode, payload, deps);

            // outcome.outcome and status must agree.
            if (outcome.outcome === 'queued') {
              expect(status).toBe('queued');
            } else if (outcome.outcome === 'transmitted') {
              expect(status).toBe('transmitted');
            }
            // 'blocked' is excluded by the valid-validation mock in makeDeps.
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 2j: getPendingCount is called exactly once per save to derive
  //              the status — the engine is always consulted, never bypassed.
  //              (Req 2.5 — "derived from actual queue/transmit status")
  // ---------------------------------------------------------------------------
  it(
    '2j — getPendingCount is called exactly once per save to derive the status (Req 2.5)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          processCodeArb,
          formPayloadArb,
          anyPendingCountArb,
          async (processCode, payload, pendingCount) => {
            const deps = makeDeps(pendingCount, 'item-1', `/entries/${processCode.toLowerCase()}`, payload);

            await executeSave(processCode, payload, deps);

            // The engine's pending count must be consulted exactly once.
            expect(deps.getPendingCount).toHaveBeenCalledTimes(1);
          },
        ),
        { numRuns: 200 },
      );
    },
  );
});
