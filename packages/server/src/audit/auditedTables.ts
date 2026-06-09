/**
 * Tables with audit.fn_audit triggers attached (M1-08).
 * Transactional + master + planning + coil tables; audit tables excluded.
 */
export const AUDITED_TABLES = [
  // Transactional capture
  'txn.shift_log',
  'txn.stoppage_entry',
  'txn.crew_entry',
  'txn.prod_hrs',
  'txn.prod_hrs_slit',
  'txn.prod_pkl',
  'txn.prod_pkl_chart',
  'txn.prod_crm',
  'txn.ann_charge',
  'txn.ann_charge_coil',
  'txn.prod_skp',
  'txn.prod_skp_pass',
  'txn.prod_rwd',
  'txn.prod_crs',
  'txn.prod_crs_slit',
  'txn.prod_ctl',
  'txn.prod_glv',
  'txn.defect_entry',
  'txn.validation_overrides',
  // Coil spine
  'coil.coil',
  'coil.coil_process_history',
  // Planning
  'planning.plan_order',
  'planning.coil_plan',
  // Master data (M1-08 §3)
  'master.customer',
  'master.grade',
  'master.grade_spec',
  'master.defect_code',
  'master.stoppage_code',
  'master.operator',
  'master.furnace',
  'master.rp_oil_grade',
  'master.surface_finish',
  'security.tenant_config',
] as const;
