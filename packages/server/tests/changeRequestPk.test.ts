import { describe, it, expect } from 'vitest';
import {
  normalizeTableName,
  resolvePkColumn,
  toDbColumnNames,
} from '../src/services/changeRequestPk';

describe('changeRequestPk', () => {
  describe('normalizeTableName', () => {
    it('keeps qualified txn table names', () => {
      expect(normalizeTableName('txn.prod_hrs')).toBe('txn.prod_hrs');
    });

    it('prefixes bare process table names', () => {
      expect(normalizeTableName('prod_crm')).toBe('txn.prod_crm');
    });
  });

  describe('resolvePkColumn', () => {
    it('resolves entry_id for prod_* tables', () => {
      expect(resolvePkColumn('txn.prod_hrs')).toBe('entry_id');
      expect(resolvePkColumn('txn.prod_crm')).toBe('entry_id');
      expect(resolvePkColumn('prod_pkl')).toBe('entry_id');
    });

    it('resolves shift_log_id for shift logs', () => {
      expect(resolvePkColumn('txn.shift_log')).toBe('shift_log_id');
    });

    it('resolves charge_no for annealing charges', () => {
      expect(resolvePkColumn('txn.ann_charge')).toBe('charge_no');
    });

    it('resolves coil_no for coil master', () => {
      expect(resolvePkColumn('coil.coil')).toBe('coil_no');
    });

    it('throws for unknown tables', () => {
      expect(() => resolvePkColumn('unknown.table')).toThrow(/No primary-key mapping/);
    });
  });

  describe('toDbColumnNames', () => {
    it('converts camelCase keys to snake_case', () => {
      expect(toDbColumnNames({ weightMt: 25, outputThkMm: 1.2 })).toEqual({
        weight_mt: 25,
        output_thk_mm: 1.2,
      });
    });

    it('preserves snake_case keys', () => {
      expect(toDbColumnNames({ weight_mt: 25 })).toEqual({ weight_mt: 25 });
    });
  });
});
