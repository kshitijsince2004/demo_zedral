import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatDisplayCoilNo,
  mapPlanSurfaceToCode,
  parseCoilIdentity,
} from '../src/utils/rwdFieldMappers';

describe('rwdFieldMappers', () => {
  it('maps BRIGHT/MATT/blank surface codes', () => {
    expect(mapPlanSurfaceToCode('BRIGHT')).toBe('B');
    expect(mapPlanSurfaceToCode('B')).toBe('B');
    expect(mapPlanSurfaceToCode('MATT')).toBe('M');
    expect(mapPlanSurfaceToCode('MATTE')).toBe('M');
    expect(mapPlanSurfaceToCode('')).toBeNull();
    expect(mapPlanSurfaceToCode(null)).toBeNull();
  });

  it('formats displayCoilNo without double-suffix', () => {
    expect(formatDisplayCoilNo('1100038398', 'G')).toBe('1100038398-G');
    expect(formatDisplayCoilNo('1100038398-G', 'G')).toBe('1100038398-G');
    expect(formatDisplayCoilNo('1100038398')).toBe('1100038398');
  });

  it('parses coil identity slit suffix', () => {
    expect(parseCoilIdentity('1100038398-G')).toEqual({ coilNo: '1100038398', slitId: 'G' });
    expect(parseCoilIdentity('1100038398')).toEqual({ coilNo: '1100038398', slitId: null });
  });
});

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

describe('AutoSourceService.resolvePrefill RWD', () => {
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

  it('prefers Plan over Prior over Master for RWD fields', async () => {
    tables.set('planning.ppc_batch', {
      coil_no: '1100038398',
      slit_id: 'G',
      customer_name: 'VICTURA/AXIS',
      width_mm: 705,
      input_thk_mm: 1.55,
      ppc_thk_mm: 1.55,
      ppc_weight_mt: 12.4,
      grade_code: 'CRCA',
      roll_finish: 'BRIGHT',
      process_route_raw: 'SRFXCLE',
      batch_number: 'BN-RWD-1',
      from_work_center: 'R',
      machine_code: 'RWD',
    });
    tables.set('txn.prod_pkl', {
      width_mm: 700,
      output_thk_mm: 1.6,
      weight_mt: 11,
    });
    tables.set('coil.coil as c', {
      grade_code: 'OTHER',
      nominal_width_mm: 600,
      coil_thk_mm: 2,
      weight_mt: 9,
      customer_name: 'MASTER CO',
    });

    const { AutoSourceService } = await import('../src/services/AutoSourceService');
    const prefill = await AutoSourceService.resolvePrefill('RWD', '1100038398');

    expect(prefill.displayCoilNo).toBe('1100038398-G');
    expect(prefill.customerName).toEqual({ value: 'VICTURA/AXIS', source: 'Plan' });
    expect(prefill.widthMm).toEqual({ value: 705, source: 'Plan' });
    expect(prefill.thicknessMm).toEqual({ value: 1.55, source: 'Plan' });
    expect(prefill.weightMt).toEqual({ value: 12.4, source: 'Plan' });
    expect(prefill.outputThkMmFallback).toEqual({ value: 1.55, source: 'Plan' });
    expect(prefill.surfaceFinish).toEqual({ value: 'B', source: 'Plan' });
    expect(prefill.routeRaw?.value).toBe('SRFXCLE');
    expect(prefill.batchNumber?.value).toBe('BN-RWD-1');
  });

  it('falls back to Prior then Master when no plan row', async () => {
    tables.set('planning.ppc_batch', null);
    tables.set('txn.prod_pkl', {
      width_mm: 700,
      output_thk_mm: 1.6,
      weight_mt: 11,
    });
    tables.set('coil.coil as c', {
      grade_code: 'CRCA',
      nominal_width_mm: 600,
      coil_thk_mm: 2,
      weight_mt: 9,
      customer_name: 'MASTER CO',
      heat_no: 'H1',
    });

    const { AutoSourceService } = await import('../src/services/AutoSourceService');
    const prefill = await AutoSourceService.resolvePrefill('RWD', 'C-NO-PLAN');

    expect(prefill.widthMm).toEqual({ value: 700, source: 'Prior' });
    expect(prefill.thicknessMm).toEqual({ value: 1.6, source: 'Prior' });
    expect(prefill.weightMt).toEqual({ value: 11, source: 'Prior' });
    expect(prefill.gradeCode).toEqual({ value: 'CRCA', source: 'Master' });
    expect(prefill.customerName).toEqual({ value: 'MASTER CO', source: 'Master' });
    expect(prefill.surfaceFinish).toBeUndefined();
  });
});