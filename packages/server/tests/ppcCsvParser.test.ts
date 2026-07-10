import { describe, expect, it } from 'vitest';
import { parsePpcCsv } from '../src/utils/ppcCsvParser';

describe('parsePpcCsv', () => {
  it('accepts CSV imports without a shift_code column when a default is provided', () => {
    const csv = `batch_number,plan_date,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt
CSV-1,2026-07-07,6HI,ROLLING,COIL-1,Acme,CRCA,1000,0.5,12`;

    const result = parsePpcCsv(csv, 'C');

    expect(result.headerError).toBeUndefined();
    expect(result.rowErrors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].shift_code).toBe('C');
  });

  it('parses input_thk_mm as a number for skin pass rows', () => {
    const csv = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,input_thk_mm,ppc_thk_mm,ppc_weight_mt
SP-1,2026-06-01,B,6HI,SKIN_PASS,COIL-1,Acme,D,1250,1.15,1.0,8`;

    const result = parsePpcCsv(csv);

    expect(result.headerError).toBeUndefined();
    expect(result.rowErrors).toEqual([]);
    expect(result.rows[0].input_thk_mm).toBe(1.15);
    expect(typeof result.rows[0].input_thk_mm).toBe('number');
  });
});
