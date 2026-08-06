import { describe, it, expect } from 'vitest';
import { DPR_FIELD_CATALOG } from '../../src/export/dpr/dprFieldCatalog';
import { dprAreasForMachines } from '../../src/export/dpr/areaGeometry';

describe('DPR field catalog', () => {
  it('catalog covers production, stoppage, disposition, and delay fields', () => {
    const ids = DPR_FIELD_CATALOG.map((f) => f.fieldId);
    expect(ids).toContain('prod_shift_a');
    expect(ids).toContain('stoppage_elect_a');
    expect(ids).toContain('scrap_shift_a');
    expect(ids).toContain('delay_time');
    expect(ids).toContain('day_date');
  });

  it('dprAreasForMachines maps 4HI to rolling-mill areas', () => {
    const areas = dprAreasForMachines(['4HI']);
    expect(areas).toContain('4HI_R');
    expect(areas).toContain('4HI_RR');
    expect(areas).toContain('4HI_SP');
  });

  it('dprAreasForMachines maps 6HI to CRM family areas', () => {
    const areas = dprAreasForMachines(['6HI']);
    expect(areas).toContain('6HI_R');
    expect(areas).toContain('2HI_SP');
  });
});
