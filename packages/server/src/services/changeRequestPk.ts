/**
 * Resolves the primary-key column for audited tables when applying change requests.
 */

const TABLE_PK_COLUMN: Record<string, string> = {
  'txn.shift_log': 'shift_log_id',
  'txn.stoppage_entry': 'stoppage_id',
  'txn.crew_entry': 'crew_id',
  'txn.prod_hrs': 'entry_id',
  'txn.prod_hrs_slit': 'slit_id',
  'txn.prod_pkl': 'entry_id',
  'txn.prod_pkl_chart': 'chart_id',
  'txn.prod_crm': 'entry_id',
  'txn.ann_charge': 'charge_no',
  'txn.prod_skp': 'entry_id',
  'txn.prod_skp_pass': 'pass_id',
  'txn.prod_rwd': 'entry_id',
  'txn.prod_crs': 'entry_id',
  'txn.prod_crs_slit': 'slit_id',
  'txn.prod_ctl': 'entry_id',
  'txn.prod_glv': 'entry_id',
  'txn.defect_entry': 'defect_id',
  'txn.validation_overrides': 'override_id',
  'coil.coil': 'coil_no',
};

export function normalizeTableName(tableName: string): string {
  if (tableName.includes('.')) return tableName;
  if (tableName.startsWith('prod_') || tableName.startsWith('ann_')) return `txn.${tableName}`;
  if (tableName === 'coil' || tableName.startsWith('coil_')) return `coil.${tableName}`;
  return `txn.${tableName}`;
}

export function resolvePkColumn(tableName: string): string {
  const normalized = normalizeTableName(tableName);
  const column = TABLE_PK_COLUMN[normalized];
  if (!column) {
    throw new Error(`No primary-key mapping for table: ${tableName}`);
  }
  return column;
}

export function toDbColumnNames(changes: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    const dbKey = key.includes('_') ? key : key.replace(/([A-Z])/g, '_$1').toLowerCase();
    result[dbKey] = value;
  }
  return result;
}
