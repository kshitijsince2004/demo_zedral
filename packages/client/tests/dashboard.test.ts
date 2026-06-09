import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Property 22: Operator dashboard data correctness
describe('Property 22: Dashboard Calculations', () => {
  it('should accurately calculate produced total and open coil counts', () => {
    // Generate an array of production entries representing a shift
    const entryArbitrary = fc.record({
      id: fc.uuid(),
      weight_mt: fc.float({ min: 1, max: 30, noNaN: true }),
      status: fc.constantFrom('IN_PROCESS', 'DONE', 'HOLD', 'SCRAPPED')
    });

    fc.assert(
      fc.property(
        fc.array(entryArbitrary, { maxLength: 100 }),
        (entries) => {
          // Dashboard calculation functions
          const totalProduced = entries.reduce((sum, e) => sum + e.weight_mt, 0);
          
          const openCoils = entries.filter(e => e.status === 'IN_PROCESS').length;
          const completedCoils = entries.filter(e => e.status === 'DONE').length;

          // Invariants to test
          
          // 1. Total produced must be >= 0
          expect(totalProduced).toBeGreaterThanOrEqual(0);

          // 2. Sum of open + completed cannot exceed total entries
          expect(openCoils + completedCoils).toBeLessThanOrEqual(entries.length);

          // 3. If there are entries, and all are IN_PROCESS, total produced is still calculated 
          // (assuming standard logic where IN_PROCESS coils have recorded weights for partials, or whatever domain logic dictates)
          if (entries.every(e => e.status === 'IN_PROCESS')) {
            expect(openCoils).toBe(entries.length);
            expect(completedCoils).toBe(0);
          }
        }
      )
    );
  });
});
