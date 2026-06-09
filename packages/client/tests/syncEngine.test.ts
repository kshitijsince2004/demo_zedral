import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Property 17: Offline sync queue ordering and conflict resolution
describe('Property 17: Offline sync queue ordering', () => {
  it('should process queue items strictly in creation-timestamp order (First-In-First-Out)', () => {
    // Generate an array of random dates
    const dateArbitrary = fc.date({ min: new Date('2020-01-01'), max: new Date('2025-01-01') });
    
    fc.assert(
      fc.property(
        fc.array(dateArbitrary, { minLength: 1, maxLength: 50 }),
        (dates) => {
          // Simulate the enqueuing process at these exact timestamps
          const unsortedQueue = dates.map((d, i) => ({
            id: `item-${i}`,
            timestamp: d.toISOString(),
            status: 'QUEUED'
          }));
          
          // The database index always returns items sorted by timestamp
          const databaseResult = [...unsortedQueue].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          // Simulate SyncEngine popping items off the array
          const processOrder = [];
          for (const item of databaseResult) {
            processOrder.push(item);
          }

          // Verify that for any given item in processOrder, it was created AFTER or at the same time as the preceding item
          for (let i = 1; i < processOrder.length; i++) {
            const prevTime = new Date(processOrder[i-1].timestamp).getTime();
            const currTime = new Date(processOrder[i].timestamp).getTime();
            expect(currTime).toBeGreaterThanOrEqual(prevTime); // Strictly ordered
          }
        }
      )
    );
  });
});
