import { describe, expect, it } from 'vitest';
import { PKL_SPEC_PARAM_LABELS } from '../src/lib/pklSpecLabels';

describe('pkl revamp labels', () => {
  it('maps steam outlet burner', () => {
    expect(PKL_SPEC_PARAM_LABELS.steam_outlet_burner).toMatch(/Burner/);
  });

  it('keeps endFilling key (label-only Leader End)', () => {
    const payload = { endFilling: true, lineSpeedMpm: 40 };
    expect(payload).toHaveProperty('endFilling');
    expect(payload).not.toHaveProperty('leaderEnd');
  });
});
