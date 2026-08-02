import { describe, it, expect } from 'vitest';
import { isPklMhDesk } from '../src/lib/pklMhDesk';

describe('pklMhDesk live routing', () => {
  it('treats sole PKL access as PKL desk', () => {
    expect(isPklMhDesk(['PKL'], null)).toBe(true);
    expect(isPklMhDesk(['PKL', 'ANN'], null)).toBe(false);
    expect(isPklMhDesk(['PKL', 'ANN'], 'PKL')).toBe(true);
  });
});
