import { describe, it, expect } from 'vitest';
import { buildMappingAuditReport, mappingAuditMarkdown } from '../../src/export/dpr/DprMappingAudit';
import { DPR_FIELD_CATALOG } from '../../src/export/dpr/dprFieldCatalog';
import { dprAreasForMachines } from '../../src/export/dpr/areaGeometry';

describe('DPR mapping audit', () => {
  it('catalog covers production, stoppage, disposition, and delay fields', () => {
    const ids = DPR_FIELD_CATALOG.map((f) => f.fieldId);
    expect(ids).toContain('prod_shift_a');
    expect(ids).toContain('stoppage_elect_a');
    expect(ids).toContain('scrap_shift_a');
    expect(ids).toContain('delay_time');
    expect(ids).toContain('day_date');
  });

  it('buildMappingAuditReport has no missing mappings', () => {
    const report = buildMappingAuditReport();
    expect(report.summary.byStatus.missing).toBe(0);
    expect(report.summary.byStatus.mapped).toBeGreaterThan(20);
    expect(report.calculatedFields.length).toBeGreaterThan(0);
  });

  it('mappingAuditMarkdown includes summary table', () => {
    const md = mappingAuditMarkdown();
    expect(md).toContain('# DPR Export — Mapping Verification Report');
    expect(md).toContain('prod_shift_a');
    expect(md).toContain('| mapped |');
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
