import { describe, it, expect } from 'vitest';
import {
  computeTotal,
  chainCumMt,
  computeAvgMt,
  computeEquipAvailMin,
  computeUtilisationPct,
  computeProdRate,
  computeDispositionPct,
  safeDiv,
  round2,
} from '../../src/export/aggregation/derivation';
import { HPH_OPERATING_BASE } from '../../src/export/aggregation/lineAreas';
import { DprAggregator } from '../../src/export/aggregation/DprAggregator';
import fixture from '../fixtures/export/may2026_subset.json';

describe('dpr derivation formulas (§6.4)', () => {
  it('TOTAL = A + B + C', () => {
    const total = computeTotal({ A: 12.22, B: 13.32, C: 43.7 });
    expect(total.total).toBe(69.24);
  });

  it('CUM chains across days', () => {
    const cum = chainCumMt([69.24, 50, 30], 10);
    expect(cum).toEqual([79.24, 129.24, 159.24]);
  });

  it('AVG = CUM / day_index', () => {
    expect(computeAvgMt(69.24, 1)).toBe(69.24);
    expect(computeAvgMt(138.48, 2)).toBe(69.24);
  });

  it('equip_avail uses 1440 base for standard lines', () => {
    const avail = computeEquipAvailMin(1440, { A: 75, B: 1370, C: 270 });
    expect(avail.A).toBe(1365);
    expect(avail.B).toBe(70);
    expect(avail.C).toBe(1170);
    expect(avail.cum).toBe(2605);
  });

  it('equip_avail uses HPH 16×24×60 base', () => {
    expect(HPH_OPERATING_BASE).toBe(23040);
    const avail = computeEquipAvailMin(HPH_OPERATING_BASE, { A: 100, B: 0, C: 0 });
    expect(avail.A).toBe(22940);
  });

  it('utilisation_pct today matches legacy example', () => {
    const util = computeUtilisationPct(685, 685, 1440, 1);
    expect(util.today).toBe(47.57);
    expect(util.cum).toBe(47.57);
  });

  it('prod_rate per shift from running minutes (equip_avail fallback)', () => {
    const prod = computeTotal({ A: 12.22, B: 13.32, C: 43.7 });
    const rates = computeProdRate(
      prod,
      { A: 405, B: 70, C: 210 },
      13.76,
    );
    expect(rates.B).toBe(11.42);
    expect(rates.C).toBe(12.49);
    expect(rates.today).toBe(6.06);
  });

  it('prod_rate today matches legacy when running minutes sum to 423', () => {
    const prod = computeTotal({ A: 12.22, B: 13.32, C: 43.7 });
    const rates = computeProdRate(prod, { A: 143.46, B: 70, C: 210 }, 13.76);
    expect(Math.abs(rates.today - 9.82)).toBeLessThanOrEqual(0.01);
  });

  it('scrap_pct within ±0.01', () => {
    expect(computeDispositionPct(2.5, 69.24)).toBe(3.61);
    expect(Math.abs(computeDispositionPct(0, 0) - 0)).toBeLessThanOrEqual(0.01);
  });

  it('division by zero returns 0', () => {
    expect(safeDiv(10, 0)).toBe(0);
    expect(safeDiv(0, 0)).toBe(0);
    expect(round2(safeDiv(5, 0) * 100)).toBe(0);
  });
});

describe('DprAggregator with May 2026 fixture', () => {
  it('aggregates 4HI_R day-1 production rollups', () => {
    const rdm = DprAggregator.aggregate({
      month: fixture.month,
      runs: fixture.runs as any,
      stoppages: fixture.stoppages as any,
      dispositions: fixture.dispositions as any,
      targets: fixture.targets as any,
    });

    const day = rdm.days[0];
    const area = day.areas.find((a) => a.areaCode === '4HI_R');
    expect(area).toBeDefined();
    expect(area!.prod.A).toBe(12.22);
    expect(area!.prod.B).toBe(13.32);
    expect(area!.prod.C).toBe(43.7);
    expect(area!.prod.total).toBe(69.24);
    expect(area!.cumMt).toBe(69.24);
    expect(area!.avgMt).toBe(69.24);
    expect(area!.targetMt).toBe(260);
    expect(area!.stoppageMin.rm_shortage).toBe(410);
  });

  it('computes month rollups for day 1', () => {
    const rdm = DprAggregator.aggregate({
      month: fixture.month,
      runs: fixture.runs as any,
      stoppages: fixture.stoppages as any,
      dispositions: [],
      targets: fixture.targets as any,
    });
    const rollups = rdm.days[0].rollups;
    expect(rollups.despatchMt).toBe(94.31);
    expect(rollups.yieldPct).toBe(94.31);
    expect(rollups.wrChange['4hi'].nos).toBe(0);
  });

  it('produces 31 day blocks for May 2026', () => {
    const rdm = DprAggregator.aggregate({
      month: '2026-05',
      runs: [],
      stoppages: [],
      dispositions: [],
      targets: [],
    });
    expect(rdm.days).toHaveLength(31);
    expect(rdm.days[0].dayIndex).toBe(1);
    expect(rdm.days[30].dayIndex).toBe(31);
  });
});
