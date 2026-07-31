import { describe, it, expect } from 'vitest';
import { isAnnMhDesk } from '../src/lib/annMhDesk';

describe('isAnnMhDesk', () => {
  it('true when focus is ANN', () => {
    expect(isAnnMhDesk(['6HI', 'ANN'], 'ANN')).toBe(true);
  });

  it('true when sole operational machine is ANN', () => {
    expect(isAnnMhDesk(['ANN'], null)).toBe(true);
  });

  it('false for multi-machine without ANN focus', () => {
    expect(isAnnMhDesk(['6HI', 'ANN'], null)).toBe(false);
    expect(isAnnMhDesk(['6HI'], '6HI')).toBe(false);
  });
});
