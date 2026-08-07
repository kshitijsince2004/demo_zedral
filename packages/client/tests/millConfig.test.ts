import { describe, it, expect } from 'vitest';
import {
  hubTabsForMill,
  millSupportsRolling,
  normalizeMillTab,
} from '../src/lib/millConfig';

describe('millConfig', () => {
  it('6HI and 4HI expose rolling and skin pass tabs', () => {
    for (const mill of ['6HI', '4HI'] as const) {
      expect(millSupportsRolling(mill)).toBe(true);
      expect(hubTabsForMill(mill).map((t) => t.id)).toEqual(['rolling', 'skinpass']);
    }
  });

  it('2HI is skin pass + rewinding (no rolling)', () => {
    expect(millSupportsRolling('2HI')).toBe(false);
    expect(hubTabsForMill('2HI').map((t) => t.id)).toEqual(['skinpass', 'rewinding']);
    expect(normalizeMillTab('2HI', 'rolling')).toBe('skinpass');
    expect(normalizeMillTab('2HI', 'skinpass')).toBe('skinpass');
    expect(normalizeMillTab('2HI', 'rewinding')).toBe('rewinding');
  });
});
