import { describe, it, expect } from 'vitest';
import { AuditTrailService } from '../src/services/AuditTrailService';

describe('AuditTrailService', () => {
  it('builds per-column UPDATE entries using baseline column names', () => {
    const entries = AuditTrailService.buildEntries(
      'txn.crm_order',
      '42',
      'UPDATE',
      { ppc_thk_mm: '0.50', coil_no: 'C-1' },
      { ppc_thk_mm: '0.48', coil_no: 'C-1' },
      7,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      table_name: 'txn.crm_order',
      record_pk: '42',
      action: 'UPDATE',
      column_name: 'ppc_thk_mm',
      old_value: '0.50',
      new_value: '0.48',
      user_id: 7,
    });
  });

  it('builds row-level INSERT snapshot when not a column diff', () => {
    const entries = AuditTrailService.buildEntries(
      'txn.prod_hrs',
      '99',
      'INSERT',
      null,
      { coil_no: 'C-2', weight_mt: 12 },
      3,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].column_name).toBeNull();
    expect(entries[0].new_value).toContain('C-2');
  });
});
