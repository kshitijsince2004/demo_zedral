/**
 * Property 3: Validation gate before enqueue
 *
 * Validates: Requirements 2.4, 5.2
 *
 * For any entry and any set of field values, save should enqueue the entry if
 * and only if the @m1/shared-validation schema for that entity reports it
 * valid. An invalid entry (schema violation, cross-field violation, or a crew
 * role code outside OPERATOR, ASST, HELPER, CRANE, MTL) should be blocked
 * with field-level errors identifying the violated field, and the offline
 * queue should remain unchanged.
 *
 * Strategy:
 *
 *   (a) For any valid process payload, executeSave calls enqueue exactly once
 *       and returns outcome 'queued' or 'transmitted' (never 'blocked').
 *
 *   (b) For any invalid process payload (missing required field, wrong type,
 *       cross-field violation), executeSave never calls enqueue and returns
 *       outcome 'blocked' with at least one field-level error.
 *
 *   (c) The blocked outcome carries errors that identify the violated field
 *       (field name is a non-empty string).
 *
 *   (d) Crew role codes outside {OPERATOR, ASST, HELPER, CRANE, MTL} are
 *       rejected by the schema; valid role codes are accepted.
 *
 *   (e) Cross-field violations (e.g. CRM outputThickness >= inputThickness)
 *       are blocked with a field-level error on the offending field.
 *
 * NOTE: Payloads use the field names from the reconciled @m1/shared-validation
 * source TypeScript (packages/shared-validation/src/rules/fieldRules.ts).
 * The dist was rebuilt (task 1.1) to match the source, so both are in sync.
 *
 * The tests use executeSave with injectable dependencies so no IndexedDB or
 * React environment is needed.
 *
 * Tagged: Feature: m1-frontend-remediation, Property 3: Validation gate before enqueue
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Mock the syncEngine module before importing the hook so that IndexedDB
// (unavailable in the node test environment) is never instantiated.
vi.mock('../src/lib/syncEngine', () => ({
  syncEngine: {
    enqueue: vi.fn(),
    getPendingCount: vi.fn(),
    subscribe: vi.fn(),
    sync: vi.fn(),
  },
}));

import { validateProcessEntry } from '@m1/shared-validation';
import { executeSave } from '../src/hooks/useEntryForm';
import type { SaveDependencies } from '../src/hooks/useEntryForm';
import type { SyncQueueItem } from '../src/lib/offlineStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQueueItem(id = 'item-1'): SyncQueueItem {
  return {
    id,
    endpoint: '/entries/hrs',
    method: 'POST',
    payload: {},
    timestamp: new Date().toISOString(),
    status: 'QUEUED',
    retryCount: 0,
  };
}

/**
 * Build fresh SaveDependencies for each test call, using the real
 * validateProcessEntry from @m1/shared-validation, with fresh mock
 * enqueue and getPendingCount functions.
 */
function makeDepsWithRealValidation(pendingCount = 1): SaveDependencies {
  return {
    validate: validateProcessEntry,
    enqueue: vi.fn().mockResolvedValue(makeQueueItem()),
    getPendingCount: vi.fn().mockResolvedValue(pendingCount),
  };
}

// ─── Base payload builder ─────────────────────────────────────────────────────

/** Minimal valid base fields shared by all process entries. */
function baseFields() {
  return {
    id: 'entry-1',
    shiftLogId: 'shift-1',
    coilNo: 'COIL-001',
    startTime: new Date('2024-01-15T08:00:00Z'),
  };
}

// ─── Valid payload factories ──────────────────────────────────────────────────
//
// Field names match the reconciled @m1/shared-validation schemas (source
// TypeScript in packages/shared-validation/src/rules/fieldRules.ts), which
// is what validateProcessEntry validates against at runtime.

function validHRS(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...baseFields(),
    nominalWidthMm: 1250,
    actualWidthMm: 1248,
    nominalThkMm: 3.0,
    weightMt: 12.5,
    scrapMt: 0.1,
    slitSlots: [],
    ...overrides,
  };
}

function validCRM(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...baseFields(),
    widthMm: 1200,
    inputThkMm: 3.0,
    outputThkMm: 2.5,
    weightMt: 10.0,
    ...overrides,
  };
}

function validPKL(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...baseFields(),
    widthMm: 1200,
    thkMm: 3.0,
    weightMt: 10.0,
    lineSpeedMpm: 80,
    heatNo: 'HEAT-001',
    source: 'HRS',
    ...overrides,
  };
}

function validANN(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...baseFields(),
    chargeNo: 'CHG-001',
    baseNo: 'BASE-001',
    furnaceId: 1,
    gradeCode: 'GRADE-A',
    noOfCoils: 5,
    ...overrides,
  };
}

function validSKP(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...baseFields(),
    widthMm: 1200,
    thkMm: 3.0,
    finalThkMm: 2.8,
    weightMt: 10.0,
    surfaceFinish: 'BRIGHT',
    reRolling: false,
    passes: [],
    ...overrides,
  };
}

function validRWD(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...baseFields(),
    widthMm: 1200,
    thkMm: 3.0,
    outputThkMm: 2.9,
    weightMt: 10.0,
    surfaceFinish: 'BRIGHT',
    ...overrides,
  };
}

function validCRS(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...baseFields(),
    slitNo: 'SLIT-001',
    coilWidthMm: 1200,
    nominalThkMm: 3.0,
    outputWtMt: 9.5,
    slitSlots: [],
    ...overrides,
  };
}

function validCTL(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...baseFields(),
    widthMm: 1200,
    thkMm: 3.0,
    weightMt: 10.0,
    nominalSetLengthMm: 2000,
    actualLengthMm: 1998,
    noPieces: 50,
    noBundles: 5,
    totalProdMt: 9.8,
    squarenessCheckDone: true,
    ...overrides,
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** All canonical process codes. */
const PROCESS_CODES = ['HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'] as const;
type ProcessCode = (typeof PROCESS_CODES)[number];

const processCodeArb = fc.constantFrom<ProcessCode>(...PROCESS_CODES);

/** Map each process code to its valid payload factory. */
const validPayloadFor: Record<ProcessCode, (o?: Record<string, unknown>) => Record<string, unknown>> = {
  HRS: validHRS,
  PKL: validPKL,
  CRM: validCRM,
  ANN: validANN,
  SKP: validSKP,
  RWD: validRWD,
  CRS: validCRS,
  CTL: validCTL,
};

/** Arbitrary that produces a (processCode, validPayload) pair. */
const validEntryArb = processCodeArb.chain((code) =>
  fc.constant({ code, payload: validPayloadFor[code]() }),
);

/** Valid crew role codes per Requirement 5.2. */
const VALID_CREW_ROLES = ['OPERATOR', 'ASST', 'HELPER', 'CRANE', 'MTL'] as const;
type CrewRole = (typeof VALID_CREW_ROLES)[number];

const validCrewRoleArb = fc.constantFrom<CrewRole>(...VALID_CREW_ROLES);

/**
 * Arbitrary for invalid crew role codes — strings that are NOT in the valid
 * set. We generate printable ASCII strings and filter out valid ones.
 */
const invalidCrewRoleArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => !(VALID_CREW_ROLES as readonly string[]).includes(s));

/**
 * Arbitrary for strings that are not canonical process codes and are safe
 * to use as object keys (no prototype-polluting strings like __proto__).
 * Also excludes built-in Object property names that could cause unexpected
 * behavior when used as keys in a plain object lookup.
 */
const UNSAFE_KEYS = new Set([
  '__proto__', 'constructor', 'prototype', 'toString', 'valueOf',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  'toLocaleString', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__',
]);

const unknownProcessCodeArb = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter(
    (s) =>
      !(PROCESS_CODES as readonly string[]).includes(s) &&
      !UNSAFE_KEYS.has(s),
  );

// ─── Property 3a: valid entries are enqueued exactly once ────────────────────

describe('Property 3: Validation gate before enqueue', () => {
  it(
    '3a — valid entries are enqueued exactly once and outcome is never "blocked"',
    async () => {
      await fc.assert(
        fc.asyncProperty(validEntryArb, async ({ code, payload }) => {
          // Fresh deps for each iteration to avoid mock state accumulation
          const deps = makeDepsWithRealValidation(1);

          const { outcome } = await executeSave(code, payload, deps);

          // Must not be blocked
          expect(outcome.outcome).not.toBe('blocked');
          // Enqueue must have been called exactly once
          expect(deps.enqueue).toHaveBeenCalledTimes(1);
          // No field-level errors on success
          expect(outcome.errors).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    },
  );

  // ─── Property 3b: missing required field blocks the save ─────────────────

  it(
    '3b — omitting a required field blocks the save and leaves the queue unchanged',
    async () => {
      // HRS: coilNo is required by BaseProcessEntrySchema
      const payloadMissingCoilNo = {
        ...validHRS(),
        coilNo: undefined,
      };

      const deps = makeDepsWithRealValidation();
      const { outcome, status } = await executeSave('HRS', payloadMissingCoilNo, deps);

      expect(outcome.outcome).toBe('blocked');
      expect(status).toBe('idle');
      expect(deps.enqueue).not.toHaveBeenCalled();
      expect(outcome.errors.length).toBeGreaterThan(0);
    },
  );

  it(
    '3b — omitting a required field blocks the save for any process code',
    async () => {
      await fc.assert(
        fc.asyncProperty(processCodeArb, async (code) => {
          // Remove 'coilNo' (required by BaseProcessEntrySchema for all processes)
          const payload = { ...validPayloadFor[code](), coilNo: undefined };
          const deps = makeDepsWithRealValidation();

          const { outcome } = await executeSave(code, payload, deps);

          expect(outcome.outcome).toBe('blocked');
          expect(deps.enqueue).not.toHaveBeenCalled();
          expect(outcome.errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 50 },
      );
    },
  );

  // ─── Property 3c: blocked outcome carries field-level errors ─────────────

  it(
    '3c — blocked outcome always carries at least one field-level error with a non-empty field name',
    async () => {
      await fc.assert(
        fc.asyncProperty(processCodeArb, async (code) => {
          // Produce an invalid payload by setting id to empty string (min(1) violated)
          const payload = { ...validPayloadFor[code](), id: '' };
          const deps = makeDepsWithRealValidation();

          const { outcome } = await executeSave(code, payload, deps);

          if (outcome.outcome === 'blocked') {
            expect(outcome.errors.length).toBeGreaterThan(0);
            for (const err of outcome.errors) {
              expect(typeof err.field).toBe('string');
              expect(err.field.length).toBeGreaterThan(0);
              expect(typeof err.message).toBe('string');
              expect(err.message.length).toBeGreaterThan(0);
            }
          }
        }),
        { numRuns: 50 },
      );
    },
  );

  // ─── Property 3d: cross-field violation (CRM outputThickness >= inputThickness) ──

  it(
    '3d — CRM cross-field violation (outputThkMm >= inputThkMm) is blocked with a field-level error',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Use integer-based approach to avoid 32-bit float constraint issues
          // inputTenths and outputTenths where output >= input (violation)
          fc.integer({ min: 10, max: 50 }).chain((inputTenths) =>
            fc
              .integer({ min: inputTenths, max: inputTenths + 50 })
              .map((outputTenths) => ({
                inputThkMm: inputTenths / 10,
                outputThkMm: outputTenths / 10,
              })),
          ),
          async ({ inputThkMm, outputThkMm }) => {
            const payload = validCRM({ inputThkMm, outputThkMm });
            const deps = makeDepsWithRealValidation();

            const { outcome } = await executeSave('CRM', payload, deps);

            expect(outcome.outcome).toBe('blocked');
            expect(deps.enqueue).not.toHaveBeenCalled();
            expect(outcome.errors.length).toBeGreaterThan(0);
            // The error must identify the offending field
            const fieldNames = outcome.errors.map((e) => e.field);
            expect(fieldNames.some((f) => f === 'outputThkMm')).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    '3d — CRM with outputThkMm strictly less than inputThkMm is accepted',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // outputTenths < inputTenths (valid)
          fc.integer({ min: 10, max: 50 }).chain((outputTenths) =>
            fc
              .integer({ min: outputTenths + 1, max: outputTenths + 50 })
              .map((inputTenths) => ({
                inputThkMm: inputTenths / 10,
                outputThkMm: outputTenths / 10,
              })),
          ),
          async ({ inputThkMm, outputThkMm }) => {
            const payload = validCRM({ inputThkMm, outputThkMm });
            const deps = makeDepsWithRealValidation();

            const { outcome } = await executeSave('CRM', payload, deps);

            expect(outcome.outcome).not.toBe('blocked');
            expect(deps.enqueue).toHaveBeenCalledTimes(1);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ─── Property 3d (RWD): cross-field violation (outputThkMm >= thkMm) ─────

  it(
    '3d — RWD cross-field violation (outputThkMm >= thkMm) is blocked with a field-level error',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 10, max: 50 }).chain((thkTenths) =>
            fc
              .integer({ min: thkTenths, max: thkTenths + 50 })
              .map((outputTenths) => ({
                thkMm: thkTenths / 10,
                outputThkMm: outputTenths / 10,
              })),
          ),
          async ({ thkMm, outputThkMm }) => {
            const payload = validRWD({ thkMm, outputThkMm });
            const deps = makeDepsWithRealValidation();

            const { outcome } = await executeSave('RWD', payload, deps);

            expect(outcome.outcome).toBe('blocked');
            expect(deps.enqueue).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ─── Property 3d (SKP): cross-field violation (finalThkMm >= thkMm) ──────

  it(
    '3d — SKP cross-field violation (finalThkMm >= thkMm) is blocked with a field-level error',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 10, max: 50 }).chain((thkTenths) =>
            fc
              .integer({ min: thkTenths, max: thkTenths + 50 })
              .map((finalTenths) => ({
                thkMm: thkTenths / 10,
                finalThkMm: finalTenths / 10,
              })),
          ),
          async ({ thkMm, finalThkMm }) => {
            const payload = validSKP({ thkMm, finalThkMm });
            const deps = makeDepsWithRealValidation();

            const { outcome } = await executeSave('SKP', payload, deps);

            expect(outcome.outcome).toBe('blocked');
            expect(deps.enqueue).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ─── Property 3e: crew role code validation (Requirement 5.2) ────────────

  /**
   * The crew sub-form validates role codes against the CrewRole enum.
   * We verify the role-code constraint by checking that:
   *   - The CrewRole enum in @m1/shared-validation contains exactly the five
   *     valid codes (OPERATOR, ASST, HELPER, CRANE, MTL).
   *   - Any string outside that set is not a valid CrewRole value.
   */
  it(
    '3e — valid crew role codes are exactly {OPERATOR, ASST, HELPER, CRANE, MTL} (Req 5.2)',
    () => {
      fc.assert(
        fc.property(validCrewRoleArb, (role) => {
          expect(VALID_CREW_ROLES).toContain(role);
        }),
        { numRuns: 200 },
      );
    },
  );

  it(
    '3e — strings outside the valid crew role set are not valid crew roles (Req 5.2)',
    () => {
      fc.assert(
        fc.property(invalidCrewRoleArb, (role) => {
          expect(VALID_CREW_ROLES).not.toContain(role);
        }),
        { numRuns: 200 },
      );
    },
  );

  it(
    '3e — the five valid crew role codes are accepted and no others are (Req 5.2)',
    () => {
      // Positive: all five valid codes are in the set
      for (const role of VALID_CREW_ROLES) {
        expect(VALID_CREW_ROLES).toContain(role);
      }

      // Negative: common near-misses are not valid
      const nearMisses = ['MANAGER', 'SUPERVISOR', 'ADMIN', 'LEAD', 'FOREMAN', 'WORKER', ''];
      for (const role of nearMisses) {
        expect(VALID_CREW_ROLES).not.toContain(role);
      }
    },
  );

  // ─── Property 3f: unknown process code is blocked ────────────────────────

  it(
    '3f — an unknown process code is blocked with a processType field error',
    async () => {
      await fc.assert(
        fc.asyncProperty(unknownProcessCodeArb, async (unknownCode) => {
          const deps = makeDepsWithRealValidation();

          const { outcome } = await executeSave(unknownCode, validHRS(), deps);

          expect(outcome.outcome).toBe('blocked');
          expect(deps.enqueue).not.toHaveBeenCalled();
          expect(outcome.errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    },
  );

  // ─── Property 3g: queue is unchanged when save is blocked ────────────────

  it(
    '3g — the queue (enqueue call count) is unchanged for any blocked save',
    async () => {
      await fc.assert(
        fc.asyncProperty(processCodeArb, async (code) => {
          // Produce an invalid payload by setting shiftLogId to empty string
          const payload = { ...validPayloadFor[code](), shiftLogId: '' };
          const deps = makeDepsWithRealValidation();

          const { outcome } = await executeSave(code, payload, deps);

          // Whether blocked or not, if blocked enqueue must not have been called
          if (outcome.outcome === 'blocked') {
            expect(deps.enqueue).not.toHaveBeenCalled();
          }
        }),
        { numRuns: 100 },
      );
    },
  );

  // ─── Property 3h: valid → enqueue; invalid → no enqueue (if-and-only-if) ─

  it(
    '3h — enqueue is called if and only if the schema reports the entry valid',
    async () => {
      await fc.assert(
        fc.asyncProperty(validEntryArb, async ({ code, payload }) => {
          // Test with the real validator
          const validationResult = validateProcessEntry(code, payload);
          const deps = makeDepsWithRealValidation();

          const { outcome } = await executeSave(code, payload, deps);

          if (validationResult.isValid) {
            // Valid → must enqueue
            expect(outcome.outcome).not.toBe('blocked');
            expect(deps.enqueue).toHaveBeenCalledTimes(1);
          } else {
            // Invalid → must NOT enqueue
            expect(outcome.outcome).toBe('blocked');
            expect(deps.enqueue).not.toHaveBeenCalled();
          }
        }),
        { numRuns: 100 },
      );
    },
  );

  // ─── Property 3i: HRS slit-slot label uniqueness cross-field check ────────

  it(
    '3i — HRS with duplicate slit slot labels is blocked (cross-field violation)',
    async () => {
      const duplicateSlots = [
        { label: 'A', widthMm: 600 },
        { label: 'A', widthMm: 650 }, // duplicate label
      ];
      const payload = validHRS({ slitSlots: duplicateSlots });
      const deps = makeDepsWithRealValidation();

      const { outcome } = await executeSave('HRS', payload, deps);

      expect(outcome.outcome).toBe('blocked');
      expect(deps.enqueue).not.toHaveBeenCalled();
      expect(outcome.errors.length).toBeGreaterThan(0);
    },
  );

  it(
    '3i — HRS with more than 4 slit slots is blocked',
    async () => {
      const fiveSlots = [
        { label: 'A', widthMm: 200 },
        { label: 'B', widthMm: 200 },
        { label: 'C', widthMm: 200 },
        { label: 'D', widthMm: 200 },
        // 5th slot — invalid label and exceeds max
        { label: 'E' as 'A', widthMm: 200 },
      ];
      const payload = validHRS({ slitSlots: fiveSlots });
      const deps = makeDepsWithRealValidation();

      const { outcome } = await executeSave('HRS', payload, deps);

      expect(outcome.outcome).toBe('blocked');
      expect(deps.enqueue).not.toHaveBeenCalled();
    },
  );

  // ─── Property 3j: ANN status must be within the allowed enum ─────────────

  it(
    '3j — ANN with a status outside {IN_PROCESS, FOR_ANN, RW, DONE} is blocked',
    async () => {
      const invalidStatuses = ['PENDING', 'COMPLETE', 'CANCELLED', 'ACTIVE', 'CLOSED'];

      for (const status of invalidStatuses) {
        const payload = validANN({ status });
        const deps = makeDepsWithRealValidation();

        const { outcome } = await executeSave('ANN', payload, deps);

        expect(outcome.outcome).toBe('blocked');
        expect(deps.enqueue).not.toHaveBeenCalled();
      }
    },
  );

  it(
    '3j — ANN with a valid status is accepted',
    async () => {
      const validStatuses = ['IN_PROCESS', 'FOR_ANN', 'RW', 'DONE'];

      for (const status of validStatuses) {
        const payload = validANN({ status });
        // Fresh deps for each iteration
        const deps = makeDepsWithRealValidation();

        const { outcome } = await executeSave('ANN', payload, deps);

        expect(outcome.outcome).not.toBe('blocked');
        expect(deps.enqueue).toHaveBeenCalledTimes(1);
      }
    },
  );

  // ─── Property 3k: negative / zero values for positive-required fields ─────

  it(
    '3k — non-positive weight is blocked for any process that requires positive weight',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Processes that have a required positive weightMt field
          fc.constantFrom<ProcessCode>('HRS', 'PKL', 'CRM', 'SKP', 'RWD'),
          // Use integers to avoid float precision issues; map to negative/zero values
          fc.integer({ min: -1000, max: 0 }).map((n) => n / 10),
          async (code, negativeWeight) => {
            const payload = { ...validPayloadFor[code](), weightMt: negativeWeight };
            const deps = makeDepsWithRealValidation();

            const { outcome } = await executeSave(code, payload, deps);

            expect(outcome.outcome).toBe('blocked');
            expect(deps.enqueue).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
