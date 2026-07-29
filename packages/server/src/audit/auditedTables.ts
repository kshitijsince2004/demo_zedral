/**
 * Tables with audit.fn_audit triggers attached (M1-08).
 * Transactional + master + planning + coil tables; audit tables excluded.
 */
export const AUDITED_TABLES = [
  // Transactional capture
  'txn.shift_log',
  'txn.stoppage',
  'txn.session_crew',
  'txn.prod_hrs',
  'txn.prod_hrs_slit',
  'txn.prod_pkl',
  'txn.prod_pkl_chart',
  'txn.crm_order',
  'txn.ann_charge',
  'txn.ann_charge_coil',
  'txn.crm_skinpass',
  'txn.prod_rwd',
  'txn.prod_crs',
  'txn.prod_crs_slit',
  'txn.prod_ctl',
  'txn.defect_entry',
  'txn.validation_overrides',
  // Coil spine
  'coil.coil',
  // Planning
  'planning.plan_order',
  'planning.coil_plan',
  // Master data (M1-08 §3)
  'master.customer',
  'master.grade',
  'master.grade_spec',
  'master.spec_parameter',
  'master.spec_sheet',
  'master.spec_sheet_version',
  'master.spec_value',
  'planning.plan_order_spec',
  'txn.qc_measurement',
  'master.process_sheet',
  'master.process_sheet_step',
  'master.process_sheet_step_check',
  'master.defect_code',
  'master.stoppage_code',
  'master.operator',
  'master.furnace',
  'master.rp_oil_grade',
  'master.surface_finish',
  'security.tenant_config',
] as const;
