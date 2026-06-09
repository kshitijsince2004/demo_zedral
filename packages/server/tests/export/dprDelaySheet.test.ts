import { describe, it, expect } from 'vitest';
import { buildDelayLog } from '../../src/export/aggregation/delaySheet';
import { DprAggregator } from '../../src/export/aggregation/DprAggregator';
import type { StoppageEventRow } from '../../src/export/read/types';
import fixture from '../fixtures/export/may2026_subset.json';

describe('DELAY sheet builder (§6.6)', () => {
  it('emits NIL / NIL / NIL for shifts with no stoppages', () => {
    const entries = buildDelayLog([], ['2026-05-01']);
    const nilRows = entries.filter((e) => e.isNil);
    expect(nilRows).toHaveLength(3);
    expect(nilRows.every((e) => e.agency === 'NIL' && e.reason === 'NIL')).toBe(true);
    expect(nilRows.every((e) => e.minutes === null)).toBe(true);
  });

  it('preserves agency vocabulary OP / EL / MECH', () => {
    const entries = buildDelayLog(fixture.stoppages as StoppageEventRow[], ['2026-05-01']);
    const agencies = entries.filter((e) => !e.isNil).map((e) => e.agency);
    expect(agencies).toContain('OP');
    expect(agencies).toContain('EL');
    expect(agencies.every((a) => ['OP', 'EL', 'MECH', 'NIL'].includes(a) || a.includes('+'))).toBe(true);
  });

  it('formats RMS reason from material stoppage', () => {
    const entries = buildDelayLog(fixture.stoppages as StoppageEventRow[], ['2026-05-01']);
    const rms = entries.find((e) => e.reason === 'RMS' || e.reason.includes('RMS'));
    expect(rms).toBeDefined();
    expect(rms!.shift).toBe('B');
    expect(rms!.minutes).toBe(410);
    expect(rms!.agency).toBe('OP');
  });

  it('composites only LUNCH+SETTING in same area×shift', () => {
    const events: StoppageEventRow[] = [
      {
        eventId: '1',
        areaCode: '4HI_R',
        prodDate: '2026-05-02',
        shiftCode: 'B',
        minutes: 30,
        agencyCode: 'OP',
        reasonCode: 'LUNCH',
        reasonLabel: 'Lunch Break',
        dprCategory: 'OPERATIONAL',
        remark: null,
      },
      {
        eventId: '2',
        areaCode: '4HI_R',
        prodDate: '2026-05-02',
        shiftCode: 'B',
        minutes: 40,
        agencyCode: 'OP',
        reasonCode: 'SETTING',
        reasonLabel: 'Setting',
        dprCategory: 'OPERATIONAL',
        remark: null,
      },
    ];
    const entries = buildDelayLog(events, ['2026-05-02']);
    const composite = entries.find(
      (e) => e.areaLabel === '4 Hi(R)' && e.shift === 'B' && e.reason.includes('LUNCH'),
    );
    expect(composite).toBeDefined();
    expect(composite!.minutes).toBe(70);
    expect(composite!.reason).toContain('SETTING');
    expect(composite!.reason).toContain('30+40');
  });

  it('keeps RMS as separate line from lunch+setting composite', () => {
    const entries = buildDelayLog(fixture.stoppages as StoppageEventRow[], ['2026-05-01']);
    const shiftB = entries.filter((e) => e.shift === 'B' && !e.isNil);
    const rms = shiftB.find((e) => e.reason === 'RMS');
    const lunch = shiftB.find((e) => e.reason.includes('LUNCH'));
    expect(rms!.minutes).toBe(410);
    expect(lunch!.minutes).toBe(70);
  });

  it('DprAggregator attaches delayLog to RDM', () => {
    const rdm = DprAggregator.aggregate({
      month: fixture.month,
      runs: fixture.runs as any,
      stoppages: fixture.stoppages as any,
      dispositions: [],
      targets: [],
    });
    expect(rdm.delayLog.length).toBeGreaterThan(0);
    expect(rdm.report).toBe('DPR');
    const hasRms = rdm.delayLog.some((e) => e.reason === 'RMS' || e.reason.includes('RMS'));
    expect(hasRms).toBe(true);
  });
});
