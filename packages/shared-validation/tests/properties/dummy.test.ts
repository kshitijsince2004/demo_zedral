import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

describe('Dummy Property Test', () => {
  it('should always be true for addition commutativity', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      })
    );
  });
});
