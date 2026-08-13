import { describe, expect, it } from 'vitest';
import {
  LINE_NAV,
  navIdsForMachines,
  navItemsForMachines,
} from '../src/lib/mhLineCapabilities';

describe('mhLineCapabilities', () => {
  it('CRS-only: live + crs-assignment + shared ops + machine-specs', () => {
    const ids = navIdsForMachines(['CRS']);
    expect(ids).toEqual([
      'live',
      'crs-assignment',
      'crew',
      'shift-review',
      'machine-specs',
      'import',
      'dpr-export',
      'traceability',
    ]);
    expect(ids).not.toContain('order-assignment');
    expect(ids).not.toContain('pkl-specs');
    expect(ids).not.toContain('ann-specs');
  });

  it('CTL-only: shared ops + machine-specs', () => {
    const ids = navIdsForMachines(['CTL']);
    expect(ids).toEqual([
      'live',
      'crew',
      'shift-review',
      'machine-specs',
      'import',
      'dpr-export',
      'traceability',
    ]);
    expect(ids).not.toContain('crs-assignment');
    expect(ids).not.toContain('order-assignment');
    expect(ids).not.toContain('pkl-specs');
    expect(ids).not.toContain('ann-specs');
  });

  it('CRM+HRS union keeps mill assignment and HRS shared items, no rolling specs', () => {
    const ids = navIdsForMachines(['6HI', 'HRS']);
    expect(ids).toContain('live');
    expect(ids).toContain('order-assignment');
    expect(ids).not.toContain('machine-specs');
    expect(ids).toContain('import');
    expect(ids).not.toContain('crs-assignment');
    expect(ids).not.toContain('pkl-specs');
    expect(ids).not.toContain('ann-specs');
  });

  it('HRS+ANN union collapses to one Live Dashboard', () => {
    const ids = navIdsForMachines(['HRS', 'ANN']);
    expect(ids.filter((id) => id === 'live' || id === 'ann-live' || id === 'rwd-live')).toEqual(['live']);
    expect(ids).toContain('ann-batching');
    expect(ids).toContain('ann-report');
    expect(ids).toContain('ann-import');
    expect(ids).toContain('ann-specs');
    expect(ids).toContain('crew');
    expect(ids).not.toContain('crs-assignment');
    expect(ids).not.toContain('order-assignment');
    expect(ids).not.toContain('pkl-specs');
  });

  it('2HI-only uses CRM Live, not RWD Live', () => {
    const ids = navIdsForMachines(['2HI']);
    expect(ids.filter((id) => id === 'live' || id === 'ann-live' || id === 'rwd-live')).toEqual(['live']);
    expect(ids).toContain('order-assignment');
    expect(ids).not.toContain('machine-specs');
  });

  it('6HI+2HI union has a single Live item', () => {
    const ids = navIdsForMachines(['6HI', '2HI']);
    expect(ids.filter((id) => id === 'live' || id === 'ann-live' || id === 'rwd-live')).toEqual(['live']);
    expect(ids).not.toContain('machine-specs');
  });

  it('resolves catalogue items in display order', () => {
    const items = navItemsForMachines(['CTL']);
    expect(items.map((i) => i.id)).toEqual(navIdsForMachines(['CTL']));
    expect(items.every((i) => typeof i.path === 'string')).toBe(true);
  });

  it('ignores unknown machine codes', () => {
    expect(navIdsForMachines(['XYZ', 'CTL'])).toEqual(navIdsForMachines(['CTL']));
    expect(navIdsForMachines([])).toEqual([]);
  });

  it('LINE_NAV covers every capability line used by the registry', () => {
    for (const code of ['HRS', 'PKL', 'ANN', 'RWD', 'CRS', 'CTL', '6HI', '4HI', '2HI'] as const) {
      expect(LINE_NAV[code].length).toBeGreaterThan(0);
    }
  });
});
