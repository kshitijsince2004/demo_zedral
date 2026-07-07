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
});
