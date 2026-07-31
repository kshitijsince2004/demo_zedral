import { describe, it, expect } from 'vitest';

/** One active stage = start set, end null, not skipped. */
function activeStageCount(stages: Array<{ start_at: string | null; end_at: string | null; skipped: boolean }>) {
  return stages.filter((s) => s.start_at && !s.end_at && !s.skipped).length;
}

describe('ANN stage single-active invariant', () => {
  it('allows exactly one active stage', () => {
    expect(activeStageCount([
      { start_at: 't0', end_at: 't1', skipped: false },
      { start_at: 't1', end_at: null, skipped: false },
      { start_at: null, end_at: null, skipped: false },
    ])).toBe(1);
  });

  it('treats skipped as inactive', () => {
    expect(activeStageCount([
      { start_at: 't0', end_at: null, skipped: true },
      { start_at: 't1', end_at: null, skipped: false },
    ])).toBe(1);
  });
});
