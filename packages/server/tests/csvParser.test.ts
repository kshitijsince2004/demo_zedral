import { describe, it, expect } from 'vitest';
import { normalizeJsonRows, parseCsvText, rowsToErrorCsv } from '../src/utils/csvParser';

describe('csvParser', () => {
  it('parses canonical CSV headers and rows', () => {
    const csv = `coil_no,customer_code,grade_code,target_width_mm,planned_process
C-1001,CUST-001,CRCA,1250,CRM
C-1002,CUST-001,D513,1100,PKL`;

    const { rows, rowErrors, headerError } = parseCsvText(csv);
    expect(headerError).toBeUndefined();
    expect(rowErrors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      coil_no: 'C-1001',
      customer_code: 'CUST-001',
      grade_code: 'CRCA',
      target_width_mm: 1250,
      planned_process: 'CRM',
    });
  });

  it('rejects CSV missing required headers', () => {
    const { headerError } = parseCsvText('coil_no,grade_code\nC-1,CRCA');
    expect(headerError).toContain('customer_code');
  });

  it('converts weight_kg to weight_mt', () => {
    const csv = `coil_no,customer_code,grade_code,weight_kg
C-1,CUST-001,CRCA,1500`;
    const { rows } = parseCsvText(csv);
    expect(rows[0].weight_mt).toBe(1.5);
  });

  it('normalizes legacy JSON rows', () => {
    const rows = normalizeJsonRows([
      {
        coilNumber: 'C-9',
        customer: 'CUST-001',
        grade: 'CRCA',
        targetThickness: 0.5,
        processCode: 'crm',
      },
    ]);
    expect(rows[0]).toMatchObject({
      coil_no: 'C-9',
      customer_code: 'CUST-001',
      grade_code: 'CRCA',
      target_thk_mm: 0.5,
      planned_process: 'crm',
    });
  });

  it('serializes error rows to downloadable CSV', () => {
    const csv = rowsToErrorCsv([
      {
        rowIndex: 3,
        rowData: {
          coil_no: 'BAD',
          customer_code: 'X',
          grade_code: 'Y',
        },
        error: 'Unknown customer_code: X',
      },
    ]);
    expect(csv).toContain('row_index,error,coil_no');
    expect(csv).toContain('Unknown customer_code: X');
  });
});
