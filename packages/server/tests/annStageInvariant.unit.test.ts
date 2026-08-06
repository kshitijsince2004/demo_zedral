import { describe, it, expect } from 'vitest';

/** One active stage = start set, end null, not skipped. */
function activeStageCount(stages: Array<{ start_at: string | null; end_at: string | null; skipped: boolean }>) {
  return stages.filter((s) => s.start_at && !s.end_at && !s.skipped).length;
}

function totalActiveMin(stages: Array<{ duration_min: number | null; skipped: boolean }>) {
  return stages.filter((s) => !s.skipped).reduce((sum, s) => sum + Number(s.duration_min ?? 0), 0);
}

function totalIdleMin(stages: Array<{ start_at: string | null; end_at: string | null; skipped: boolean; seq: number }>) {
  const live = stages.filter((s) => !s.skipped).sort((a, b) => a.seq - b.seq);
  let idle = 0;
  for (let i = 1; i < live.length; i++) {
    const prev = live[i - 1];
    const cur = live[i];
    if (prev.end_at && cur.start_at) {
      idle += (new Date(cur.start_at).getTime() - new Date(prev.end_at).getTime()) / 60000;
    }
  }
  return idle;
}

const CYCLE = [
  ['LOADING', 1, 'Loading', false],
  ['PURGING', 2, 'Purging', false],
  ['HEATING', 3, 'Heating', false],
  ['SOAKING', 4, 'Soaking', false],
  ['FURNACE_COOL', 5, 'Furnace Cool', false],
  ['NATURAL_COOL', 6, 'Natural Cool', false],
  ['RAPID_COOL', 7, 'Rapid Cool', true],
  ['WATER_COOL', 8, 'Water Cool', true],
  ['POST_PURGING', 9, 'Post Purging', false],
  ['UNLOADING', 10, 'Unloading', false],
] as const;

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

describe('ANN 10-stage cycle', () => {
  it('defines seq 1–10 with only RAPID_COOL and WATER_COOL skippable', () => {
    expect(CYCLE.map((r) => r[0])).toEqual([
      'LOADING', 'PURGING', 'HEATING', 'SOAKING', 'FURNACE_COOL',
      'NATURAL_COOL', 'RAPID_COOL', 'WATER_COOL', 'POST_PURGING', 'UNLOADING',
    ]);
    expect(CYCLE.filter((r) => r[3]).map((r) => r[0])).toEqual(['RAPID_COOL', 'WATER_COOL']);
    expect(CYCLE.map((r) => r[1])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('totals exclude skipped stages; idle is gaps only', () => {
    expect(totalActiveMin([
      { duration_min: 60, skipped: false },
      { duration_min: 30, skipped: true },
      { duration_min: 45, skipped: false },
    ])).toBe(105);

    expect(totalIdleMin([
      { seq: 1, start_at: '2026-08-05T10:00:00Z', end_at: '2026-08-05T11:00:00Z', skipped: false },
      { seq: 2, start_at: '2026-08-05T11:15:00Z', end_at: '2026-08-05T12:00:00Z', skipped: false },
    ])).toBe(15);
  });
});
