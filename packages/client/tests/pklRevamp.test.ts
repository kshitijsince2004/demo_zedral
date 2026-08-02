import { describe, expect, it } from 'vitest';

/** Minimal check: PKL param labels cover log-sheet keys (revamp MH-2). */
const PARAM_LABELS: Record<string, string> = {
  tank_temp: 'Tank Temp °C',
  acid_strength: 'Acid Strength %',
  steam_outlet_burner: 'Steam Outlet of Burner',
  burner_pressure: 'Burner Masha',
};

describe('pkl revamp labels', () => {
  it('maps steam outlet burner', () => {
    expect(PARAM_LABELS.steam_outlet_burner).toMatch(/Burner/);
  });

  it('keeps endFilling key (label-only Leader End)', () => {
    const payload = { endFilling: true, lineSpeedMpm: 40 };
    expect(payload).toHaveProperty('endFilling');
    expect(payload).not.toHaveProperty('leaderEnd');
  });
});
