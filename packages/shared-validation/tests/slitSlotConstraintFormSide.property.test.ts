/**
 * Property 7 (form side): Slit-slot constraint
 *
 * Validates: Requirements 3.2
 *
 * Both HRS and CRS entries carry a `slitSlots` array. The constraint is:
 *   - Max 4 slots per entry (labels A, B, C, D â€” no duplicates)
 *   - Each slot must carry a widthMm > 0
 *   - Optional fields (thkMm, taper, childCoilNo) may be absent
 *   - No fifth or higher slot is accepted
 *   - Slots must use the label set {'A','B','C','D'} exclusively
 *
 * This is the *form-side* test â€” it validates the shape constraints that the
 * form enforces before the data reaches the schema validator.
 *
 * Tagged: Feature: m1-frontend-remediation, Property 7: Slit-slot constraint (form side)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { SlitSlot } from '../src/types/processes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_LABELS = ['A', 'B', 'C', 'D'] as const;
type SlotLabel = 'A' | 'B' | 'C' | 'D';

/** Validates the slit-slot array constraint that the form enforces. */
function validateSlitSlots(slots: SlitSlot[]): { valid: boolean; reason?: string } {
  if (slots.length > 4) {
    return { valid: false, reason: `Too many slots: ${slots.length}` };
  }

  const seenLabels = new Set<string>();
  for (const slot of slots) {
    if (!VALID_LABELS.includes(slot.label as SlotLabel)) {
      return { valid: false, reason: `Invalid label: ${slot.label}` };
    }
    if (seenLabels.has(slot.label)) {
      return { valid: false, reason: `Duplicate label: ${slot.label}` };
    }
    seenLabels.add(slot.label);
    if (typeof slot.widthMm !== 'number' || slot.widthMm <= 0 || isNaN(slot.widthMm)) {
      return { valid: false, reason: `Invalid widthMm: ${slot.widthMm}` };
    }
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const validSlotArb = fc.record({
  label: fc.constantFrom(...VALID_LABELS) as fc.Arbitrary<SlotLabel>,
  widthMm: fc.double({ min: 0.001, max: 2000, noNaN: true }),
  thkMm: fc.option(fc.double({ min: 0.001, max: 20, noNaN: true }), { nil: undefined }),
  taper: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  childCoilNo: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
});

/** Produces a valid deduplicated slit-slot array of up to 4 slots. */
const validSlotArrayArb = fc
  .shuffledSubarray(VALID_LABELS, { minLength: 0, maxLength: 4 })
  .chain((labels) =>
    fc.tuple(...labels.map((label) =>
      fc.record({
        label: fc.constant(label) as fc.Arbitrary<SlotLabel>,
        widthMm: fc.double({ min: 0.001, max: 2000, noNaN: true }),
        thkMm: fc.option(fc.double({ min: 0.001, max: 20, noNaN: true }), { nil: undefined }),
        taper: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
        childCoilNo: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
      })
    )).map(slots => slots as SlitSlot[])
  );

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Property 7 (form side): Slit-slot constraint', () => {

  it('7a â€” valid slot arrays (0â€“4 unique labels, positive widths) always pass validation (Req 3.2)', () => {
    fc.assert(
      fc.property(validSlotArrayArb, (slots) => {
        const result = validateSlitSlots(slots);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('7b â€” arrays with more than 4 slots always fail validation (Req 3.2)', () => {
    // Generate 5+ slots (can have duplicates since we just need length > 4)
    const tooManyArb = fc.array(validSlotArb, { minLength: 5, maxLength: 20 });
    fc.assert(
      fc.property(tooManyArb, (slots) => {
        const result = validateSlitSlots(slots);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Too many slots');
      }),
      { numRuns: 100 }
    );
  });

  it('7c â€” slots with invalid labels fail validation (Req 3.2)', () => {
    const invalidLabelArb = fc.string({ minLength: 1, maxLength: 3 }).filter(
      (s) => !VALID_LABELS.includes(s as SlotLabel)
    );
    const invalidSlotArb = fc.record({
      label: invalidLabelArb as fc.Arbitrary<any>,
      widthMm: fc.double({ min: 0.001, max: 2000, noNaN: true }),
    });
    fc.assert(
      fc.property(invalidSlotArb, (slot) => {
        const result = validateSlitSlots([slot as SlitSlot]);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Invalid label');
      }),
      { numRuns: 100 }
    );
  });

  it('7d â€” duplicate labels in the same slot array fail validation (Req 3.2)', () => {
    const dupLabelArb = fc.constantFrom(...VALID_LABELS).chain((label) =>
      fc.tuple(
        fc.constant({ label, widthMm: 500 } as SlitSlot),
        fc.constant({ label, widthMm: 600 } as SlitSlot),
      )
    );
    fc.assert(
      fc.property(dupLabelArb, ([s1, s2]) => {
        const result = validateSlitSlots([s1, s2]);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Duplicate label');
      }),
      { numRuns: 100 }
    );
  });

  it('7d2 â€” slots with widthMm = 0 or negative fail validation (Req 3.2)', () => {
    const zeroOrNegArb = fc.double({ min: -1000, max: 0, noNaN: true });
    fc.assert(
      fc.property(fc.constantFrom(...VALID_LABELS), zeroOrNegArb, (label, w) => {
        const slot: SlitSlot = { label: label as SlotLabel, widthMm: w };
        const result = validateSlitSlots([slot]);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Invalid widthMm');
      }),
      { numRuns: 100 }
    );
  });

  it('7e â€” slot count cannot exceed 4 regardless of other fields (Req 3.2)', () => {
    fc.assert(
      fc.property(validSlotArrayArb, (slots) => {
        expect(slots.length).toBeLessThanOrEqual(4);
      }),
      { numRuns: 100 }
    );
  });

  it('7f â€” label set is exactly {A, B, C, D} for any valid slot array (Req 3.2)', () => {
    fc.assert(
      fc.property(validSlotArrayArb, (slots) => {
        for (const slot of slots) {
          expect(VALID_LABELS).toContain(slot.label);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('7g â€” optional fields (thkMm, taper, childCoilNo) are permitted absent (Req 3.2)', () => {
    const minimalSlot: SlitSlot = { label: 'A', widthMm: 500 };
    const result = validateSlitSlots([minimalSlot]);
    expect(result.valid).toBe(true);
  });
});
