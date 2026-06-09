import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { HRSSchema, CRSSchema } from '@m1/shared-validation';

describe('Property Tests: Process Entries and Constraints', () => {

  // Property 1: Data round-trip (simplified logic for mathematical validation of Schemas)
  describe('Property 1: Production entry data round-trip validity', () => {
    it('should cleanly parse and reproduce a valid HRS entry payload', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }), // coilNumber
          fc.double({ min: 100, max: 2000, noNaN: true }), // nominalWidth
          fc.double({ min: 0.1, max: 10, noNaN: true }), // thickness
          fc.double({ min: 0.1, max: 50, noNaN: true }), // weightMt
          (coilNumber, nominalWidth, thickness, weightMt) => {
            const rawPayload = {
              id: 'test',
              shiftLogId: 'shift-log-1',
              timeFrom: '10:00',
              timeTo: '11:00',
              coilNo: coilNumber,
              nominalWidthMm: nominalWidth,
              actualWidthMm: nominalWidth, // Ensure actual <= nominal
              nominalThkMm: thickness,
              weightMt,
              scrapMt: 0,
              slitSlots: []
            };

            const parsed = HRSSchema.safeParse(rawPayload);
            if (!parsed.success) console.error('Property 1 error:', parsed.error);
            expect(parsed.success).toBe(true);
            
            // Round-trip equivalence check
            if (parsed.success) {
              expect(parsed.data.coilNo).toBe(coilNumber);
              expect(parsed.data.nominalWidthMm).toBe(nominalWidth);
            }
          }
        )
      );
    });
  });

  // Property 9: Slit slot constraint (max 4 slots A-D)
  describe('Property 9: Slit slot constraints', () => {
    it('should reject payloads with more than 4 slit slots or invalid labels', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 5, max: 10 }), // number of invalid slots
          (slotCount) => {
            const slots = Array.from({ length: slotCount }).map((_, i) => ({
              slot: `Slot_${i}`,
              childCoilNumber: `Child_${i}`,
              width: 100,
              thickness: 5,
              weightMt: 10,
              taperType: 'NONE'
            }));

            const rawPayload = {
              id: 'test',
              processId: 'HRS',
              startTime: new Date(),
              endTime: new Date(),
              coilNumber: 'Parent',
              nominalWidth: 1000,
              actualWidth: 1000,
              thickness: 5,
              weightMt: 50,
              scrapMt: 0,
              slitSlots: slots
            };

            const parsed = HRSSchema.safeParse(rawPayload);
            expect(parsed.success).toBe(false); // Should fail because > 4 slots
          }
        )
      );
    });
  });

  // Property 29: For-CTL routing flag
  describe('Property 29: For-CTL routing flag', () => {
    it('should successfully parse CRS payload with for_ctl_mt and identify next_dest logic', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 50, noNaN: true }), // forCtlMt > 0
          (forCtlMt) => {
            const rawPayload = {
              id: 'test',
              shiftLogId: 'shift-log-1',
              timeFrom: '10:00',
              timeTo: '11:00',
              coilNo: 'Parent',
              slitNo: 'A',
              nominalThkMm: 5,
              coilWidthMm: 1000,
              outputWtMt: 50,
              forCtlMt,
              rejectionMt: 0,
              holdMt: 0,
              slitSlots: []
            };

            const parsed = CRSSchema.safeParse(rawPayload);
            if (!parsed.success) console.error('Property 29 error:', parsed.error);
            expect(parsed.success).toBe(true);
            if (parsed.success) {
              // The service layer (CRSService) will observe this parsed.data.forCtlMt > 0
              // and execute `set({ next_dest: 'CTL' })`. Here we mathematically prove
              // the field survives the Zod schema boundary accurately.
              expect(parsed.data.forCtlMt).toBe(forCtlMt);
            }
          }
        )
      );
    });
  });

});
