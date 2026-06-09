/**
 * Property 7: Slit-slot constraint (schema side)
 * Validates: Requirements 3.2
 *
 * For any HR Slitting or CR Slitter entry, the form and schema should accept
 * 1 to 4 slit slots labeled A through D, each carrying its slot fields
 * (width, thickness, taper, child coil number where applicable), and should
 * reject any attempt to add a 5th slot or to use a label outside A–D.
 *
 * Feature: m1-frontend-remediation, Property 7: Slit-slot constraint (schema side)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { HRSSchema, CRSSchema, SlitSlotSchema } from '../../src/rules/fieldRules';

// ─── Shared base payloads ─────────────────────────────────────────────────────

const baseHRS = {
  id: 'hrs-1',
  shiftLogId: 'sl-1',
  coilNo: 'C001',
  startTime: new Date('2024-01-01T06:00:00Z'),
  nominalWidthMm: 1000,
  actualWidthMm: 990,
  nominalThkMm: 3.5,
  weightMt: 10,
  scrapMt: 0.5,
};

const baseCRS = {
  id: 'crs-1',
  shiftLogId: 'sl-1',
  coilNo: 'C001',
  startTime: new Date('2024-01-01T06:00:00Z'),
  slitNo: 'S001',
  coilWidthMm: 1000,
  nominalThkMm: 2.5,
  outputWtMt: 9.5,
};

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Valid slot labels */
const validLabels = ['A', 'B', 'C', 'D'] as const;

/** Arbitrary for a single valid slit slot */
const validSlitSlotArb = fc.record({
  label: fc.constantFrom(...validLabels),
  widthMm: fc.double({ min: 1, max: 2000, noNaN: true }),
  thkMm: fc.option(fc.double({ min: 0.1, max: 20, noNaN: true }), { nil: undefined }),
  taper: fc.option(fc.string({ minLength: 0, maxLength: 20 }), { nil: undefined }),
  childCoilNo: fc.option(fc.string({ minLength: 0, maxLength: 20 }), { nil: undefined }),
});

/**
 * Arbitrary for 1–4 slit slots with unique labels drawn from A–D.
 * We pick a count (1–4), then shuffle the label pool and take the first `count`.
 */
const validSlitSlotsArb = fc
  .integer({ min: 1, max: 4 })
  .chain((count) =>
    fc
      .shuffledSubarray(validLabels as unknown as string[], { minLength: count, maxLength: count })
      .chain((labels) =>
        fc.tuple(
          ...labels.map((label) =>
            fc.record({
              label: fc.constant(label),
              widthMm: fc.double({ min: 1, max: 2000, noNaN: true }),
              thkMm: fc.option(fc.double({ min: 0.1, max: 20, noNaN: true }), { nil: undefined }),
              taper: fc.option(fc.string({ minLength: 0, maxLength: 20 }), { nil: undefined }),
              childCoilNo: fc.option(fc.string({ minLength: 0, maxLength: 20 }), { nil: undefined }),
            })
          )
        )
      )
  )
  .map((slots) => slots as Array<{ label: string; widthMm: number; thkMm?: number; taper?: string; childCoilNo?: string }>);

/** Arbitrary for an invalid label (anything not in A–D) */
const invalidLabelArb = fc.string({ minLength: 1, maxLength: 5 }).filter(
  (s) => !validLabels.includes(s as (typeof validLabels)[number])
);

// ─── Property 7a: SlitSlotSchema accepts valid labels A–D ─────────────────────

describe('Property 7: Slit-slot constraint (schema side)', () => {
  describe('SlitSlotSchema — individual slot validation', () => {
    it('7a: should accept any slot with a label in {A, B, C, D} and positive width', () => {
      fc.assert(
        fc.property(validSlitSlotArb, (slot) => {
          const result = SlitSlotSchema.safeParse(slot);
          expect(result.success).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('7b: should reject any slot whose label is outside {A, B, C, D}', () => {
      fc.assert(
        fc.property(
          invalidLabelArb,
          fc.double({ min: 1, max: 2000, noNaN: true }),
          (label, widthMm) => {
            const slot = { label, widthMm };
            const result = SlitSlotSchema.safeParse(slot);
            expect(result.success).toBe(false);
            if (!result.success) {
              const labelIssue = result.error.issues.find((i) => i.path.includes('label'));
              expect(labelIssue).toBeDefined();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── Property 7c/d: HRSSchema slit-slot array constraints ──────────────────

  describe('HRSSchema — slit-slot array constraints', () => {
    it('7c: should accept HRS entries with 1–4 uniquely-labeled slit slots (A–D)', () => {
      fc.assert(
        fc.property(validSlitSlotsArb, (slitSlots) => {
          const entry = { ...baseHRS, slitSlots };
          const result = HRSSchema.safeParse(entry);
          expect(result.success).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('7d: should reject HRS entries with 5 or more slit slots', () => {
      // Build a 5-slot array: use all 4 valid labels + one duplicate (which also
      // triggers the unique-label check, but the max(4) check fires first).
      const fiveSlots = [
        { label: 'A', widthMm: 100 },
        { label: 'B', widthMm: 100 },
        { label: 'C', widthMm: 100 },
        { label: 'D', widthMm: 100 },
        { label: 'A', widthMm: 100 }, // 5th slot — must be rejected
      ];

      fc.assert(
        fc.property(
          // Generate extra slots beyond 4 by appending duplicates
          fc.integer({ min: 1, max: 10 }).chain((extra) =>
            fc.tuple(
              ...Array.from({ length: extra }, () =>
                fc.record({
                  label: fc.constantFrom(...validLabels),
                  widthMm: fc.double({ min: 1, max: 2000, noNaN: true }),
                })
              )
            )
          ),
          (extraSlots) => {
            const slots = [...fiveSlots, ...extraSlots];
            const entry = { ...baseHRS, slitSlots: slots };
            const result = HRSSchema.safeParse(entry);
            expect(result.success).toBe(false);
            if (!result.success) {
              // Should have a slitSlots-level error (max 4 or unique labels)
              const slitIssue = result.error.issues.find((i) =>
                i.path.some((p) => p === 'slitSlots')
              );
              expect(slitIssue).toBeDefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('7e: should reject HRS entries with a slot label outside A–D', () => {
      fc.assert(
        fc.property(
          invalidLabelArb,
          fc.double({ min: 1, max: 2000, noNaN: true }),
          (badLabel, widthMm) => {
            const entry = {
              ...baseHRS,
              slitSlots: [{ label: badLabel, widthMm }],
            };
            const result = HRSSchema.safeParse(entry);
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('7f: should reject HRS entries with duplicate slot labels', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...validLabels),
          fc.double({ min: 1, max: 2000, noNaN: true }),
          fc.double({ min: 1, max: 2000, noNaN: true }),
          (label, width1, width2) => {
            const entry = {
              ...baseHRS,
              slitSlots: [
                { label, widthMm: width1 },
                { label, widthMm: width2 }, // duplicate label
              ],
            };
            const result = HRSSchema.safeParse(entry);
            expect(result.success).toBe(false);
            if (!result.success) {
              const slitIssue = result.error.issues.find((i) =>
                i.path.some((p) => p === 'slitSlots')
              );
              expect(slitIssue).toBeDefined();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── Property 7g/h: CRSSchema slit-slot array constraints ──────────────────

  describe('CRSSchema — slit-slot array constraints', () => {
    it('7g: should accept CRS entries with 1–4 uniquely-labeled slit slots (A–D)', () => {
      fc.assert(
        fc.property(validSlitSlotsArb, (slitSlots) => {
          const entry = { ...baseCRS, slitSlots };
          const result = CRSSchema.safeParse(entry);
          expect(result.success).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('7h: should reject CRS entries with 5 or more slit slots', () => {
      const fiveSlots = [
        { label: 'A', widthMm: 100 },
        { label: 'B', widthMm: 100 },
        { label: 'C', widthMm: 100 },
        { label: 'D', widthMm: 100 },
        { label: 'A', widthMm: 100 }, // 5th slot
      ];

      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }).chain((extra) =>
            fc.tuple(
              ...Array.from({ length: extra }, () =>
                fc.record({
                  label: fc.constantFrom(...validLabels),
                  widthMm: fc.double({ min: 1, max: 2000, noNaN: true }),
                })
              )
            )
          ),
          (extraSlots) => {
            const slots = [...fiveSlots, ...extraSlots];
            const entry = { ...baseCRS, slitSlots: slots };
            const result = CRSSchema.safeParse(entry);
            expect(result.success).toBe(false);
            if (!result.success) {
              const slitIssue = result.error.issues.find((i) =>
                i.path.some((p) => p === 'slitSlots')
              );
              expect(slitIssue).toBeDefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('7i: should reject CRS entries with a slot label outside A–D', () => {
      fc.assert(
        fc.property(
          invalidLabelArb,
          fc.double({ min: 1, max: 2000, noNaN: true }),
          (badLabel, widthMm) => {
            const entry = {
              ...baseCRS,
              slitSlots: [{ label: badLabel, widthMm }],
            };
            const result = CRSSchema.safeParse(entry);
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // ─── Property 7j: Slot fields are carried correctly ────────────────────────

  describe('Slot field completeness', () => {
    it('7j: should accept slots carrying all optional fields (width, thickness, taper, childCoilNo)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...validLabels),
          fc.double({ min: 1, max: 2000, noNaN: true }),
          fc.double({ min: 0.1, max: 20, noNaN: true }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (label, widthMm, thkMm, taper, childCoilNo) => {
            const slot = { label, widthMm, thkMm, taper, childCoilNo };
            const slotResult = SlitSlotSchema.safeParse(slot);
            expect(slotResult.success).toBe(true);

            // Also verify it works inside HRS
            const hrsEntry = { ...baseHRS, slitSlots: [slot] };
            const hrsResult = HRSSchema.safeParse(hrsEntry);
            expect(hrsResult.success).toBe(true);

            // And inside CRS
            const crsEntry = { ...baseCRS, slitSlots: [slot] };
            const crsResult = CRSSchema.safeParse(crsEntry);
            expect(crsResult.success).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('7k: should reject slots with non-positive width', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...validLabels),
          fc.double({ max: 0, noNaN: true }).filter((n) => n <= 0),
          (label, widthMm) => {
            const slot = { label, widthMm };
            const result = SlitSlotSchema.safeParse(slot);
            expect(result.success).toBe(false);
            if (!result.success) {
              const widthIssue = result.error.issues.find((i) => i.path.includes('widthMm'));
              expect(widthIssue).toBeDefined();
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
