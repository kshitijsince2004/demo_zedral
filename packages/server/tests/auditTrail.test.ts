import { describe, it, expect } from 'vitest';
import { AuditTrailService } from '../src/services/AuditTrailService';
import { AUDITED_TABLES } from '../src/audit/auditedTables';

describe('AuditTrailService', () => {
  it('builds per-column UPDATE entries using baseline column names', () => {
    const entries = AuditTrailService.buildEntries(
      'txn.prod_crm',
      '42',
      'UPDATE',
      { output_thk_mm: '0.50', coil_no: 'C-1' },
      { output_thk_mm: '0.48', coil_no: 'C-1' },
      7,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      table_name: 'txn.prod_crm',
      record_pk: '42',
      action: 'UPDATE',
      column_name: 'output_thk_mm',
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

describe('auditedTables', () => {
  it('covers transactional capture tables and master data', () => {
    expect(AUDITED_TABLES).toContain('txn.prod_crm');
    expect(AUDITED_TABLES).toContain('txn.shift_log');
    expect(AUDITED_TABLES).toContain('master.grade_spec');
    expect(AUDITED_TABLES).toContain('coil.coil');
    expect(AUDITED_TABLES).not.toContain('audit.audit_log');
    expect(AUDITED_TABLES.length).toBeGreaterThanOrEqual(28);
  });
});
