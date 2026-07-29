import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;

function makeSelectChain(result: Row | null | Row[]) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = self;
  builder.selectAll = self;
  builder.leftJoin = self;
  builder.innerJoin = self;
  builder.orderBy = self;
  builder.where = self;
  builder.executeTakeFirst = async () => (Array.isArray(result) ? result[0] ?? null : result);
  builder.execute = async () => (Array.isArray(result) ? result : result ? [result] : []);
  return builder;
}

describe('AutoSourceService.resolvePrefill CTL', () => {
  const tables = new Map<string, Row | null>();

  beforeEach(() => {
    tables.clear();
    vi.resetModules();
    vi.doMock('../src/db', () => ({
      db: {
        selectFrom: (table: string) => makeSelectChain(tables.get(table) ?? null),
      },
    }));
  });

  it('prefers Prior weight over Plan for CTL (CTL-Q1)', async () => {
    tables.set('planning.ppc_batch', {
      coil_no: '1100036818',
      slit_id: 'B',
      customer_name: 'K R AUTO',
      width_mm: 77,
      input_thk_mm: 1.19,
      ppc_thk_mm: 1.19,
      ppc_weight_mt: 0.31,
      grade_code: 'D',
      process_route_raw: 'SP4RFXCLE',
      batch_number: '2005643788',
      from_work_center: 'L',
      machine_code: 'CTL',
      raw_row_json: JSON.stringify({
        lengthMm: 1020,
        plannedPcs: 1500,
        noOfRows: 8,
        prodVersion: 'CTL5',
      }),
    });
    tables.set('txn.prod_crs', {
      coil_width_mm: 76,
      nominal_thk_mm: 1.2,
      output_wt_mt: 0.28,
    });
    tables.set('coil.coil as c', {
      grade_code: 'OTHER',
      nominal_width_mm: 70,
      coil_thk_mm: 2,
      weight_mt: 0.2,
      customer_name: 'MASTER CO',
    });

    const { AutoSourceService } = await import('../src/services/AutoSourceService');
    const prefill = await AutoSourceService.resolvePrefill('CTL', '1100036818');

    expect(prefill.displayCoilNo).toBe('1100036818-B');
    expect(prefill.customerName).toEqual({ value: 'K R AUTO', source: 'Plan' });
    expect(prefill.widthMm).toEqual({ value: 77, source: 'Plan' });
    expect(prefill.thicknessMm).toEqual({ value: 1.19, source: 'Plan' });
    expect(prefill.weightMt).toEqual({ value: 0.28, source: 'Prior' });
    expect(prefill.nominalLengthMm).toEqual({ value: 1020, source: 'Plan' });
    expect(prefill.plannedPcs).toEqual({ value: 1500, source: 'Plan' });
    expect(prefill.plannedBundles).toEqual({ value: 8, source: 'Plan' });
    expect(prefill.prodVersion).toEqual({ value: 'CTL5', source: 'Plan' });
  });

  it('falls back to plan weight when no CRS prior', async () => {
    tables.set('planning.ppc_batch', {
      coil_no: '1100036818',
      slit_id: 'B',
      customer_name: 'K R AUTO',
      width_mm: 77,
      input_thk_mm: 1.19,
      ppc_thk_mm: 1.19,
      ppc_weight_mt: 0.31,
      grade_code: 'D',
      from_work_center: 'L',
      machine_code: 'CTL',
      raw_row_json: null,
    });
    tables.set('txn.prod_crs', null);
    tables.set('coil.coil as c', null);

    const { AutoSourceService } = await import('../src/services/AutoSourceService');
    const prefill = await AutoSourceService.resolvePrefill('CTL', '1100036818');

    expect(prefill.weightMt).toEqual({ value: 0.31, source: 'Plan' });
  });
});
