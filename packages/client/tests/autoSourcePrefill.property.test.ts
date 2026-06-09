/**
 * Property 9: Auto-source prefill resolution and editability
 *
 * Validates: Requirements 4.3, 4.4
 *
 * For any set of prefilled fields returned by the auto-source service:
 *   - Every field that carries a value should render as an editable, confirmable
 *     prefill whose value the operator can override (updating local form state).
 *   - Every field with no provided value should render empty and available for
 *     manual entry.
 *
 * Tagged: Feature: m1-frontend-remediation, Property 9: Auto-source prefill resolution and editability
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { autoSourceService, type ProcessCode } from '../src/services/autoSourceService';
import { apiClient } from '../src/lib/apiClient';

vi.mock('../src/lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const mockedGet = vi.mocked(apiClient.get);

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Server-side source enum values */
const serverSourceArb = fc.constantFrom(
  'PLANNING',
  'COIL_MASTER',
  'GRADE_SPEC',
  'PREVIOUS_PROCESS',
  'MANUAL',
) as fc.Arbitrary<'PLANNING' | 'COIL_MASTER' | 'GRADE_SPEC' | 'PREVIOUS_PROCESS' | 'MANUAL'>;

/** Non-null, non-undefined primitive values that a server field might carry */
const nonNullValueArb = fc.oneof(
  fc.float({ min: Math.fround(0.1), max: Math.fround(9999), noNaN: true }),
  fc.string({ minLength: 1, maxLength: 40 }),
  fc.integer({ min: 1, max: 9999 }),
  fc.boolean(),
);

/** A server field that carries a real value from a non-MANUAL source (should become a prefill) */
const sourcedFieldArb = fc.record({
  value: nonNullValueArb,
  source: fc.constantFrom(
    'PLANNING',
    'COIL_MASTER',
    'GRADE_SPEC',
    'PREVIOUS_PROCESS',
  ) as fc.Arbitrary<'PLANNING' | 'COIL_MASTER' | 'GRADE_SPEC' | 'PREVIOUS_PROCESS'>,
  isEditable: fc.boolean(),
});

/** A server field that should NOT become a prefill (null/undefined value, or MANUAL source) */
const unsourcedFieldArb = fc.oneof(
  // MANUAL source with any value
  fc.record({
    value: fc.oneof(nonNullValueArb, fc.constant(null), fc.constant(undefined)),
    source: fc.constant('MANUAL') as fc.Arbitrary<'MANUAL'>,
    isEditable: fc.boolean(),
  }),
  // Non-MANUAL source but null value
  fc.record({
    value: fc.constant(null),
    source: fc.constantFrom('PLANNING', 'COIL_MASTER', 'GRADE_SPEC', 'PREVIOUS_PROCESS') as fc.Arbitrary<
      'PLANNING' | 'COIL_MASTER' | 'GRADE_SPEC' | 'PREVIOUS_PROCESS'
    >,
    isEditable: fc.boolean(),
  }),
  // Non-MANUAL source but undefined value
  fc.record({
    value: fc.constant(undefined),
    source: fc.constantFrom('PLANNING', 'COIL_MASTER', 'GRADE_SPEC', 'PREVIOUS_PROCESS') as fc.Arbitrary<
      'PLANNING' | 'COIL_MASTER' | 'GRADE_SPEC' | 'PREVIOUS_PROCESS'
    >,
    isEditable: fc.boolean(),
  }),
);

/** A valid field name (alphanumeric camelCase-style) */
const fieldNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9]{1,19}$/);

/** Canonical process codes */
const processCodeArb = fc.constantFrom<ProcessCode>(
  'HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL',
);

/** A valid coil number string */
const coilNoArb = fc.stringMatching(/^[A-Z0-9-]{3,20}$/);

// ---------------------------------------------------------------------------
// Helper: source enum → client-facing source label
// ---------------------------------------------------------------------------
const sourceMap: Record<string, string> = {
  PLANNING: 'planning',
  COIL_MASTER: 'coil_master',
  GRADE_SPEC: 'grade_spec',
  PREVIOUS_PROCESS: 'previous_process',
};

// ---------------------------------------------------------------------------
// Property 9a: Every field with a value from a non-MANUAL source becomes a
//              confirmable prefill in the result (Requirement 4.3)
// ---------------------------------------------------------------------------
describe('Property 9: Auto-source prefill resolution and editability', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it(
    '9a — every sourced field with a value appears as a confirmable prefill (Req 4.3)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate a map of 1–10 sourced fields (all have values, non-MANUAL sources)
          fc.uniqueArray(fieldNameArb, { minLength: 1, maxLength: 10 }).chain((names) =>
            fc.tuple(
              fc.constant(names),
              fc.array(sourcedFieldArb, { minLength: names.length, maxLength: names.length }),
            ),
          ),
          processCodeArb,
          coilNoArb,
          async ([names, fields], processId, coilNo) => {
            const serverFields: Record<string, unknown> = {};
            for (let i = 0; i < names.length; i++) {
              serverFields[names[i]] = fields[i];
            }

            mockedGet.mockResolvedValue({ fields: serverFields });

            const result = await autoSourceService.getPrefilledFields(processId, coilNo);

            // Every sourced field with a value MUST appear in the result
            for (let i = 0; i < names.length; i++) {
              const name = names[i];
              const serverField = fields[i];

              expect(result.fields).toHaveProperty(name);

              const prefill = result.fields[name];

              // Value is preserved exactly
              expect(prefill.value).toStrictEqual(serverField.value);

              // Source is mapped to the client-facing label
              expect(prefill.source).toBe(sourceMap[serverField.source]);

              // editable flag mirrors the server's isEditable
              expect(prefill.editable).toBe(serverField.isEditable);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 9b: Every field with no provided value (null/undefined) or a
  //              MANUAL source is absent from the result so the form renders
  //              it empty for manual entry (Requirement 4.4)
  // ---------------------------------------------------------------------------
  it(
    '9b — fields with no value or MANUAL source are absent (render empty for manual entry) (Req 4.4)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate a map of 1–10 unsourced fields
          fc.uniqueArray(fieldNameArb, { minLength: 1, maxLength: 10 }).chain((names) =>
            fc.tuple(
              fc.constant(names),
              fc.array(unsourcedFieldArb, { minLength: names.length, maxLength: names.length }),
            ),
          ),
          processCodeArb,
          coilNoArb,
          async ([names, fields], processId, coilNo) => {
            const serverFields: Record<string, unknown> = {};
            for (let i = 0; i < names.length; i++) {
              serverFields[names[i]] = fields[i];
            }

            mockedGet.mockResolvedValue({ fields: serverFields });

            const result = await autoSourceService.getPrefilledFields(processId, coilNo);

            // None of the unsourced fields should appear in the result
            for (const name of names) {
              expect(result.fields).not.toHaveProperty(name);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 9c: Mixed response — sourced fields appear, unsourced fields are
  //              absent; the two sets are disjoint in the result (Req 4.3, 4.4)
  // ---------------------------------------------------------------------------
  it(
    '9c — mixed response: sourced fields appear, unsourced fields are absent (Req 4.3, 4.4)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate disjoint sets of sourced and unsourced field names
          fc
            .uniqueArray(fieldNameArb, { minLength: 2, maxLength: 16 })
            .chain((allNames) => {
              const splitAt = Math.max(1, Math.floor(allNames.length / 2));
              const sourcedNames = allNames.slice(0, splitAt);
              const unsourcedNames = allNames.slice(splitAt);
              return fc.tuple(
                fc.constant(sourcedNames),
                fc.array(sourcedFieldArb, {
                  minLength: sourcedNames.length,
                  maxLength: sourcedNames.length,
                }),
                fc.constant(unsourcedNames),
                fc.array(unsourcedFieldArb, {
                  minLength: unsourcedNames.length,
                  maxLength: unsourcedNames.length,
                }),
              );
            }),
          processCodeArb,
          coilNoArb,
          async ([sourcedNames, sourcedFields, unsourcedNames, unsourcedFields], processId, coilNo) => {
            const serverFields: Record<string, unknown> = {};
            for (let i = 0; i < sourcedNames.length; i++) {
              serverFields[sourcedNames[i]] = sourcedFields[i];
            }
            for (let i = 0; i < unsourcedNames.length; i++) {
              serverFields[unsourcedNames[i]] = unsourcedFields[i];
            }

            mockedGet.mockResolvedValue({ fields: serverFields });

            const result = await autoSourceService.getPrefilledFields(processId, coilNo);

            // All sourced fields must be present
            for (const name of sourcedNames) {
              expect(result.fields).toHaveProperty(name);
            }

            // All unsourced fields must be absent
            for (const name of unsourcedNames) {
              expect(result.fields).not.toHaveProperty(name);
            }

            // The result contains exactly the sourced fields (no extras)
            const resultKeys = Object.keys(result.fields);
            for (const key of resultKeys) {
              expect(sourcedNames).toContain(key);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 9d: Operator override — updating a prefilled value in local form
  //              state replaces the prefill value while preserving other fields
  //              (Requirement 4.3: "value the operator can override, updating
  //              local form state")
  //
  //  This property models the form-state update as a pure function:
  //    applyOverride(formState, fieldName, newValue) → updated formState
  //  and verifies the invariants that must hold after any override.
  // ---------------------------------------------------------------------------
  it(
    '9d — operator override updates the targeted field and leaves others unchanged (Req 4.3)',
    () => {
      /**
       * Pure model of the form-state update an operator performs when
       * overriding a prefilled value. The form keeps the prefill metadata
       * (source, editable) but replaces the value with the operator's input.
       */
      function applyOverride(
        formState: Record<string, { value: unknown; source: string; editable: boolean }>,
        fieldName: string,
        newValue: unknown,
      ): Record<string, { value: unknown; source: string; editable: boolean }> {
        if (!(fieldName in formState)) return formState;
        return {
          ...formState,
          [fieldName]: { ...formState[fieldName], value: newValue },
        };
      }

      fc.assert(
        fc.property(
          // Build a form state from 1–8 sourced fields
          fc.uniqueArray(fieldNameArb, { minLength: 1, maxLength: 8 }).chain((names) =>
            fc.tuple(
              fc.constant(names),
              fc.array(
                fc.record({
                  value: nonNullValueArb,
                  source: fc.constantFrom('planning', 'coil_master', 'grade_spec', 'previous_process'),
                  editable: fc.constant(true), // only editable fields can be overridden
                }),
                { minLength: names.length, maxLength: names.length },
              ),
            ),
          ),
          // The field the operator overrides (pick from the names)
          fc.integer({ min: 0, max: 7 }),
          // The new value the operator enters
          nonNullValueArb,
          ([names, fieldDefs], indexSeed, newValue) => {
            // Build the initial form state
            const formState: Record<string, { value: unknown; source: string; editable: boolean }> = {};
            for (let i = 0; i < names.length; i++) {
              formState[names[i]] = fieldDefs[i];
            }

            const targetIndex = indexSeed % names.length;
            const targetField = names[targetIndex];
            const originalValue = formState[targetField].value;

            const updated = applyOverride(formState, targetField, newValue);

            // 1. The targeted field now carries the operator's value
            expect(updated[targetField].value).toStrictEqual(newValue);

            // 2. Source and editable metadata are preserved
            expect(updated[targetField].source).toBe(formState[targetField].source);
            expect(updated[targetField].editable).toBe(formState[targetField].editable);

            // 3. All other fields are unchanged
            for (const name of names) {
              if (name === targetField) continue;
              expect(updated[name]).toStrictEqual(formState[name]);
            }

            // 4. If the new value differs from the original, the state is dirty
            //    (i.e. the updated value is not the same as the original prefill)
            if (newValue !== originalValue) {
              expect(updated[targetField].value).not.toStrictEqual(originalValue);
            }
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 9e: Empty server response → empty prefill map (all fields render
  //              empty for manual entry) (Requirement 4.4)
  // ---------------------------------------------------------------------------
  it(
    '9e — empty server response yields an empty prefill map (all fields manual) (Req 4.4)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          processCodeArb,
          coilNoArb,
          async (processId, coilNo) => {
            mockedGet.mockResolvedValue({ fields: {} });

            const result = await autoSourceService.getPrefilledFields(processId, coilNo);

            expect(Object.keys(result.fields)).toHaveLength(0);
          },
        ),
        { numRuns: 50 },
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Property 9f: The editable flag on each prefill exactly mirrors the server's
  //              isEditable — no field is silently made non-overridable or
  //              silently made overridable (Requirement 4.3)
  // ---------------------------------------------------------------------------
  it(
    '9f — editable flag faithfully mirrors server isEditable for every prefill (Req 4.3)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(fieldNameArb, { minLength: 1, maxLength: 12 }).chain((names) =>
            fc.tuple(
              fc.constant(names),
              fc.array(
                fc.record({
                  value: nonNullValueArb,
                  source: fc.constantFrom(
                    'PLANNING',
                    'COIL_MASTER',
                    'GRADE_SPEC',
                    'PREVIOUS_PROCESS',
                  ) as fc.Arbitrary<'PLANNING' | 'COIL_MASTER' | 'GRADE_SPEC' | 'PREVIOUS_PROCESS'>,
                  isEditable: fc.boolean(),
                }),
                { minLength: names.length, maxLength: names.length },
              ),
            ),
          ),
          processCodeArb,
          coilNoArb,
          async ([names, fields], processId, coilNo) => {
            const serverFields: Record<string, unknown> = {};
            for (let i = 0; i < names.length; i++) {
              serverFields[names[i]] = fields[i];
            }

            mockedGet.mockResolvedValue({ fields: serverFields });

            const result = await autoSourceService.getPrefilledFields(processId, coilNo);

            for (let i = 0; i < names.length; i++) {
              const name = names[i];
              const serverField = fields[i];
              expect(result.fields[name].editable).toBe(serverField.isEditable);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
