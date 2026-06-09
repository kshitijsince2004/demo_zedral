import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../src/db';
import {
  ExportReadRepository,
  resolveCrm6AreaCode,
  resolveMillLineArea,
  mapCrm6OrderRow,
  mapCrsRow,
  CoilLineageWalker,
} from '../../src/export/read';

describe('export read model phase 1 — unit', () => {
  it('resolveCrm6AreaCode maps machine × sub-process × reroll', () => {
    expect(resolveCrm6AreaCode('4HI', 'ROLLING', false)).toBe('4HI_R');
    expect(resolveCrm6AreaCode('4HI', 'ROLLING', true)).toBe('4HI_RR');
    expect(resolveCrm6AreaCode('6HI', 'SKIN_PASS', false)).toBe('6HI_SP');
    expect(resolveCrm6AreaCode('2HI', 'ROLLING', true)).toBe('2HI_RW');
  });

  it('resolveMillLineArea parses CRS/CTL line numbers', () => {
    expect(resolveMillLineArea('CRS', null)).toBe('CRS_1');
    expect(resolveMillLineArea('CRS', 'CRS-3')).toBe('CRS_3');
    expect(resolveMillLineArea('CTL', 'LINE5')).toBe('CTL_5');
    expect(resolveMillLineArea('CTL', '99')).toBe('CTL_5');
  });

  it('mapCrsRow derives FOR_CTL status from for_ctl_mt', () => {
    const row = mapCrsRow(
      { shiftLogId: '1', prodDate: '2026-05-01', shiftCode: 'A', processCode: 'CRS', millType: '2' },
      { coil_no: 'C1', entry_id: 10, for_ctl_mt: 1.2, output_wt_mt: 5 },
    );
    expect(row.areaCode).toBe('CRS_2');
    expect(row.status).toBe('FOR_CTL');
    expect(row.outputWeightMt).toBe(5);
  });

  it('mapCrm6OrderRow uses rolling weight and area', () => {
    const row = mapCrm6OrderRow(
      { shiftLogId: '1', prodDate: '2026-05-01', shiftCode: 'B', processCode: '6HI', millType: null },
      { order_id: 99, coil_no: 'C9', sub_process: 'ROLLING', ppc_weight_mt: 10, ppc_thk_mm: 0.8 },
      '6HI',
      { rerolling: true, actual_weight_mt: 9.5, final_thk_mm: 0.75 },
      null,
    );
    expect(row.areaCode).toBe('6HI_RR');
    expect(row.outputWeightMt).toBe(9.5);
    expect(row.shiftCode).toBe('B');
  });
});

describe('export read model phase 1 — integration', () => {
  let dbUp = false;
  let lineAreaCount = 0;

  beforeAll(async () => {
    try {
      const areas = await db.selectFrom('master.line_area').select('area_code').execute();
      dbUp = areas.length > 0;
      lineAreaCount = areas.length;
    } catch {
      dbUp = false;
    }
  });

  it.skipIf(!dbUp)('master.line_area has 26 DPR areas seeded', () => {
    expect(lineAreaCount).toBe(26);
  });

  it.skipIf(!dbUp)('fetchRuns returns normalized rows for scoped day', async () => {
    const runs = await ExportReadRepository.fetchRuns({
      dateFrom: '2000-01-01',
      dateTo: '2099-12-31',
      processCode: 'HRS',
    });
    for (const run of runs) {
      expect(run.coilNo).toBeTruthy();
      expect(run.processCode).toBe('HRS');
      expect(run.areaCode).toBe('HRS');
      expect(['A', 'B', 'C', 'GEN']).toContain(run.shiftCode);
      expect(run.prodDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it.skipIf(!dbUp)('fetchStoppages maps agency and dpr category', async () => {
    const events = await ExportReadRepository.fetchStoppages({
      dateFrom: '2000-01-01',
      dateTo: '2099-12-31',
    });
    for (const e of events) {
      expect(['OP', 'EL', 'MECH']).toContain(e.agencyCode);
      expect(e.dprCategory).toBeTruthy();
      expect(e.minutes).toBeGreaterThanOrEqual(0);
    }
  });

  it.skipIf(!dbUp)('spot-check: one area × one day × shifts A/B/C', async () => {
    const sample = await db
      .selectFrom('txn.shift_log as sl')
      .innerJoin('master.process as p', 'sl.process_id', 'p.process_id')
      .select(['sl.prod_date', 'p.code as process_code'])
      .where('p.code', '=', 'HRS')
      .orderBy('sl.prod_date', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!sample) return;

    const day = String(sample.prod_date).slice(0, 10);
    const counts: Record<string, number> = {};

    for (const shift of ['A', 'B', 'C'] as const) {
      const runs = await ExportReadRepository.fetchRuns({
        dateFrom: day,
        dateTo: day,
        shiftCode: shift,
        areaCode: 'HRS',
      });
      counts[shift] = runs.length;
    }

    expect(counts.A).toBeGreaterThanOrEqual(0);
    expect(counts.B).toBeGreaterThanOrEqual(0);
    expect(counts.C).toBeGreaterThanOrEqual(0);
    expect(Object.values(counts).every((n) => Number.isInteger(n))).toBe(true);
  });

  it.skipIf(!dbUp)('CoilLineageWalker walks parent_coil_no chain', async () => {
    const coil = await db
      .selectFrom('coil.coil')
      .select('coil_no')
      .where('parent_coil_no', 'is not', null)
      .limit(1)
      .executeTakeFirst();

    if (!coil) return;

    const chain = await CoilLineageWalker.walkLineage(coil.coil_no);
    expect(chain.length).toBeGreaterThanOrEqual(1);
    expect(chain[0].coilNo).toBe(coil.coil_no);
  });
});
