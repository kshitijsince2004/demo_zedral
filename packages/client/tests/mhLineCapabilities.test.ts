import { describe, expect, it } from 'vitest';
import {
  LINE_NAV,
  navIdsForMachines,
  navItemsForMachines,
} from '../src/lib/mhLineCapabilities';

describe('mhLineCapabilities', () => {
  it('CRS-only: live + crs-assignment + shared ops, no specs/order-assignment', () => {
    const ids = navIdsForMachines(['CRS']);
    expect(ids).toEqual([
      'live',
      'crs-assignment',
      'crew',
      'shift-review',
      'import',
      'dpr-export',
      'traceability',
    ]);
    expect(ids).not.toContain('order-assignment');
    expect(ids).not.toContain('machine-specs');
    expect(ids).not.toContain('pkl-specs');
    expect(ids).not.toContain('ann-specs');
  });

  it('CTL-only: shared ops only — no crs-assignment or specs', () => {
    const ids = navIdsForMachines(['CTL']);
    expect(ids).toEqual([
      'live',
      'crew',
      'shift-review',
      'import',
      'dpr-export',
      'traceability',
    ]);
    expect(ids).not.toContain('crs-assignment');
    expect(ids).not.toContain('order-assignment');
    expect(ids).not.toContain('pkl-specs');
    expect(ids).not.toContain('ann-specs');
    expect(ids).not.toContain('machine-specs');
  });

  it('CRM+HRS union keeps mill assignment/specs and HRS shared items', () => {
    const ids = navIdsForMachines(['6HI', 'HRS']);
    expect(ids).toContain('live');
    expect(ids).toContain('order-assignment');
    expect(ids).toContain('machine-specs');
    expect(ids).toContain('import');
    expect(ids).not.toContain('crs-assignment');
    expect(ids).not.toContain('pkl-specs');
    expect(ids).not.toContain('ann-specs');
  });

  it('HRS+ANN union merges both line capability sets without CRS leak', () => {
    const ids = navIdsForMachines(['HRS', 'ANN']);
    expect(ids).toContain('live');
    expect(ids).toContain('ann-live');
    expect(ids).toContain('ann-batching');
    expect(ids).toContain('ann-report');
    expect(ids).toContain('ann-import');
    expect(ids).toContain('ann-specs');
    expect(ids).toContain('crew');
    expect(ids).not.toContain('crs-assignment');
    expect(ids).not.toContain('order-assignment');
    expect(ids).not.toContain('pkl-specs');
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
