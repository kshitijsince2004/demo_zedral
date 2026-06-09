import { BaseProcessEntry } from './models';

// ─── Slit slot (HR Slitting) ──────────────────────────────────────────────────
// Maps to txn.prod_hrs_slit
export interface HRSSlitSlot {
  /** Slot label A–D (max 4 per entry) */
  label: 'A' | 'B' | 'C' | 'D';
  /** Slit width in mm */
  widthMm: number;
  /** Slit thickness in mm */
  thkMm?: number;
  /** Taper description */
  taper?: string;
  /** Child coil number produced from this slot */
  childCoilNo?: string;
}

// ─── Slit slot (CR Slitting) ──────────────────────────────────────────────────
// Maps to txn.prod_crs_slit
export interface CRSSlitSlot {
  /** Slot label A–D (max 4 per entry) */
  label: 'A' | 'B' | 'C' | 'D';
  /** Slit width in mm */
  widthMm: number;
  /** Child coil number produced from this slot */
  childCoilNo?: string;
}

// ─── HR Slitting ─────────────────────────────────────────────────────────────
// Maps to txn.prod_hrs (+txn.prod_hrs_slit)
export interface HRSEntry extends BaseProcessEntry {
  /** Nominal width in mm (txn.prod_hrs.nominal_width_mm) */
  nominalWidthMm: number;
  /** Actual width in mm (txn.prod_hrs.actual_width_mm) */
  actualWidthMm: number;
  /** Nominal thickness in mm (txn.prod_hrs.nominal_thk_mm) */
  nominalThkMm: number;
  /** Weight in MT (txn.prod_hrs.weight_mt) */
  weightMt: number;
  /** Scrap weight in MT (txn.prod_hrs.scrap_mt) */
  scrapMt: number;
  /** Derived: scrap % — computed, not captured (txn.prod_hrs.scrap_pct) */
  // scrapPct is derived
  /** Actual slit width range from (txn.prod_hrs.actual_slit_width_from_mm) */
  actualSlitWidthFromMm?: number;
  /** Actual slit width range to (txn.prod_hrs.actual_slit_width_to_mm) */
  actualSlitWidthToMm?: number;
  /** Slit slots A–D (txn.prod_hrs_slit) */
  slitSlots: HRSSlitSlot[];
}

// ─── Pickling – coil log ──────────────────────────────────────────────────────
// Maps to txn.prod_pkl
export interface PKLEntry extends BaseProcessEntry {
  /** Width in mm (txn.prod_pkl.width_mm) */
  widthMm: number;
  /** Thickness in mm (txn.prod_pkl.thk_mm) */
  thkMm: number;
  /** Weight in MT (txn.prod_pkl.weight_mt) */
  weightMt: number;
  /** Line speed in m/min (txn.prod_pkl.line_speed_mpm) */
  lineSpeedMpm: number;
  /** Heat number (txn.prod_pkl.heat_no) */
  heatNo: string;
  /** Source (txn.prod_pkl.source) */
  source: string;
  /** WIP status as coded/text (txn.prod_pkl.wip) */
  wip?: string;
  /** Leader end as coded/text (txn.prod_pkl.leader_end) */
  leaderEnd?: string;
}

// ─── Pickling – hourly process chart ─────────────────────────────────────────
// Maps to txn.prod_pkl_chart; one row per (shift_log_id, chart_time, tank_no)
export interface PKLChartRow {
  id: string;
  shiftLogId: string;
  /** Time of reading in HH:mm format (txn.prod_pkl_chart.chart_time) */
  chartTime: string;
  /** Tank number 1–3 (txn.prod_pkl_chart.tank_no) */
  tankNo: 1 | 2 | 3;
  /** Tank level (txn.prod_pkl_chart.tank_level) */
  tankLevel?: number;
  /** Tank temperature °C (txn.prod_pkl_chart.tank_temp_degc) */
  tankTempDegC?: number;
  /** Acid strength % (txn.prod_pkl_chart.acid_strength_pct) */
  acidStrengthPct?: number;
  /** Iron strength % (txn.prod_pkl_chart.iron_strength_pct) */
  ironStrengthPct?: number;
  /** Steam inlet kg/cm² (txn.prod_pkl_chart.steam_inlet_kgcm2) */
  steamInletKgCm2?: number;
  /** Steam outlet kg/cm² (txn.prod_pkl_chart.steam_outlet_kgcm2) */
  steamOutletKgCm2?: number;
  /** Dosage acid (txn.prod_pkl_chart.dosage_acid) */
  dosageAcid?: number;
  /** Dosage water (txn.prod_pkl_chart.dosage_water) */
  dosageWater?: number;
  /** Dosage inhibitor (txn.prod_pkl_chart.dosage_inhibitor) */
  dosageInhibitor?: number;
  /** Rinse Cl (txn.prod_pkl_chart.rinse_cl) */
  rinseCl?: number;
  /** Rinse pH (txn.prod_pkl_chart.rinse_ph) */
  rinsePh?: number;
  /** Rinse flow (txn.prod_pkl_chart.rinse_flow) */
  rinseFlow?: number;
  /** Rinse temperature °C (txn.prod_pkl_chart.rinse_temp_degc) */
  rinseTempDegC?: number;
  /** Rinse acid % (txn.prod_pkl_chart.rinse_acid_pct) */
  rinseAcidPct?: number;
  /** Rinse iron % (txn.prod_pkl_chart.rinse_iron_pct) */
  rinseIronPct?: number;
  /** Burner pressure kg/cm² (txn.prod_pkl_chart.burner_pressure_kgcm2) */
  burnerPressureKgCm2?: number;
  /** Hot air temperature °C (txn.prod_pkl_chart.hot_air_temp_degc) */
  hotAirTempDegC?: number;
}

// ─── Cold Rolling Mill ────────────────────────────────────────────────────────
// Maps to txn.prod_crm
export interface CRMEntry extends BaseProcessEntry {
  /** Width in mm (txn.prod_crm.width_mm) */
  widthMm: number;
  /** Input thickness in mm (txn.prod_crm.input_thk_mm) */
  inputThkMm: number;
  /** Output thickness in mm; must be < inputThkMm (txn.prod_crm.output_thk_mm) */
  outputThkMm: number;
  /** Weight in MT (txn.prod_crm.weight_mt) */
  weightMt: number;
  /** Annealing hardness (txn.prod_crm.ann_hardness) */
  annHardness?: number;
  /** Hardness VPN (txn.prod_crm.hardness_vpn) */
  hardnessVpn?: number;
  /** Hardness HRB (txn.prod_crm.hardness_hrb) */
  hardnessHrb?: number;
  /** Roll in identifier (txn.prod_crm.roll_in) */
  rollIn?: string;
  /** Roll out identifier (txn.prod_crm.roll_out) */
  rollOut?: string;
  /** Oil level initial (txn.prod_crm.oil_level_initial) */
  oilLevelInitial?: number;
  /** Oil level final (txn.prod_crm.oil_level_final) */
  oilLevelFinal?: number;
  /** Oil consumption (txn.prod_crm.oil_consumption) */
  oilConsumption?: number;
  /** RW tension in kg (txn.prod_crm.rw_tension_kg) */
  rwTensionKg?: number;
  /** TKG weight in MT (txn.prod_crm.tkg_weight_mt) */
  tkgWeightMt?: number;
  /** Elongation % (txn.prod_crm.elongation_pct) */
  elongationPct?: number;
  /** Loss % (txn.prod_crm.loss_pct) */
  lossPct?: number;
  /** Stretch % (txn.prod_crm.stretch_pct) */
  stretchPct?: number;
  /** Scrap in MT (txn.prod_crm.scrap_mt) */
  scrapMt?: number;
}

// ─── Annealing ────────────────────────────────────────────────────────────────
// Maps to txn.ann_charge
export interface ANNEntry extends BaseProcessEntry {
  /** Charge number (txn.ann_charge.charge_no) */
  chargeNo: string;
  /** Base number (txn.ann_charge.base_no) */
  baseNo: string;
  /** Furnace ID FK (txn.ann_charge.furnace_id) */
  furnaceId: number;
  /** Grade code FK (txn.ann_charge.grade_code) */
  gradeCode: string;
  /** Number of coils (txn.ann_charge.no_of_coils) */
  noOfCoils: number;
  /** Derived: charge weight in MT — computed from coil weights, not captured (txn.ann_charge.charge_wt_mt) */
  // chargeWtMt is derived
  /** Charge status (txn.ann_charge.status) */
  status?: 'IN_PROCESS' | 'FOR_ANN' | 'RW' | 'DONE';
  /** Dew point N2 (txn.ann_charge.dew_point_n2) */
  dewPointN2?: number;
  /** Dew point H2 (txn.ann_charge.dew_point_h2) */
  dewPointH2?: number;
  /** Temperature °C (txn.ann_charge.temperature_degc) */
  temperatureDegC?: number;
  /** Expected unloading time (txn.ann_charge.exp_unloading_time) */
  expUnloadingTime?: string; // ISO timestamp string
  /** Unloading weight MT (txn.ann_charge.unloading_wt_mt) */
  unloadingWtMt?: number;
  /** Loading MT (txn.ann_charge.loading_mt) */
  loadingMt?: number;
  /** Unloading MT (txn.ann_charge.unloading_mt) */
  unloadingMt?: number;
  /** Cumulative loading MT (txn.ann_charge.cumm_loading_mt) */
  cummLoadingMt?: number;
  /** Cumulative unloading MT (txn.ann_charge.cumm_unloading_mt) */
  cummUnloadingMt?: number;
}

// ─── Skin Pass ────────────────────────────────────────────────────────────────
// Maps to txn.prod_skp (+txn.prod_skp_pass)
// Per-pass shape: {pass_no ∈ 1..6, thickness_mm} only — no per-pass tension
export interface SKPPass {
  /** Pass number 1–6 (txn.prod_skp_pass.pass_no) */
  passNo: number;
  /** Achieved thickness in mm (txn.prod_skp_pass.thickness_mm) */
  thicknessMm: number;
}

export interface SKPEntry extends BaseProcessEntry {
  /** Width in mm (txn.prod_skp.width_mm) */
  widthMm: number;
  /** Input thickness in mm (txn.prod_skp.thk_mm) */
  thkMm: number;
  /** Final thickness in mm (txn.prod_skp.final_thk_mm) */
  finalThkMm: number;
  /** Total passes (txn.prod_skp.total_passes) */
  totalPasses?: number;
  /** Weight in MT (txn.prod_skp.weight_mt) */
  weightMt: number;
  /** RW tension in kg (txn.prod_skp.rw_tension_kg) */
  rwTensionKg?: number;
  /** Surface finish coded reference (txn.prod_skp.surface_finish) */
  surfaceFinish: string;
  /** Re-rolling flag (txn.prod_skp.re_rolling) */
  reRolling: boolean;
  /** Hold weight in MT (txn.prod_skp.hold_mt) */
  holdMt?: number;
  /** Rejection weight in MT (txn.prod_skp.rejection_mt) */
  rejectionMt?: number;
  /** Rolling weight in MT (txn.prod_skp.wt_rolling_mt) */
  wtRollingMt?: number;
  /** Re-roll weight in MT (txn.prod_skp.wt_reroll_mt) */
  wtRerollMt?: number;
  /** Skin-pass weight in MT (txn.prod_skp.wt_skinpass_mt) */
  wtSkinpassMt?: number;
  /** Scrap weight in MT (txn.prod_skp.wt_scrap_mt) */
  wtScrapMt?: number;
  /** Rolls in identifier (txn.prod_skp.rolls_in) */
  rollsIn?: string;
  /** Rolls out identifier (txn.prod_skp.rolls_out) */
  rollsOut?: string;
  /** Coolant temperature °C (txn.prod_skp.coolant_temp_degc) */
  coolantTempDegC?: number;
  /** Coolant pressure kg/cm² (txn.prod_skp.coolant_press_kgcm2) */
  coolantPressKgCm2?: number;
  /** Per-pass records (txn.prod_skp_pass) — thickness only, no tension */
  passes: SKPPass[];
}

// ─── Rewinding ────────────────────────────────────────────────────────────────
// Maps to txn.prod_rwd
export interface RWDEntry extends BaseProcessEntry {
  /** Width in mm (txn.prod_rwd.width_mm) */
  widthMm: number;
  /** Input thickness in mm (txn.prod_rwd.thk_mm) */
  thkMm: number;
  /** Output thickness in mm (txn.prod_rwd.output_thk_mm) */
  outputThkMm: number;
  /** Weight in MT (txn.prod_rwd.weight_mt) */
  weightMt: number;
  /** RW tension 1 in kg (txn.prod_rwd.rw_tension_1_kg) */
  rwTension1Kg?: number;
  /** RW tension 2 in kg (txn.prod_rwd.rw_tension_2_kg) */
  rwTension2Kg?: number;
  /** RW tension 3 in kg (txn.prod_rwd.rw_tension_3_kg) */
  rwTension3Kg?: number;
  /** Surface finish coded reference (txn.prod_rwd.surface_finish) */
  surfaceFinish: string;
}

// ─── CR Slitter ───────────────────────────────────────────────────────────────
// Maps to txn.prod_crs (+txn.prod_crs_slit)
export interface CRSEntry extends BaseProcessEntry {
  /** Slit number (txn.prod_crs.slit_no) */
  slitNo: string;
  /** Coil width in mm (txn.prod_crs.coil_width_mm) */
  coilWidthMm: number;
  /** Nominal thickness in mm (txn.prod_crs.nominal_thk_mm) */
  nominalThkMm: number;
  /** Actual width in mm (txn.prod_crs.actual_width_mm) */
  actualWidthMm?: number;
  /** Actual thickness front in mm (txn.prod_crs.actual_thk_front_mm) */
  actualThkFrontMm?: number;
  /** Actual thickness rear in mm (txn.prod_crs.actual_thk_rear_mm) */
  actualThkRearMm?: number;
  /** Hardness VPN (txn.prod_crs.hardness_vpn) */
  hardnessVpn?: number;
  /** Hardness HRB (txn.prod_crs.hardness_hrb) */
  hardnessHrb?: number;
  /** IB TIECV (txn.prod_crs.ib_tiecv) */
  ibTiecv?: string;
  /** UTS N/mm² (txn.prod_crs.uts_nmm2) */
  utsNmm2?: number;
  /** Elongation % (txn.prod_crs.elongation_pct) */
  elongationPct?: number;
  /** YSR burr (txn.prod_crs.ysr_burr) */
  ysrBurr?: string;
  /** Camber/waviness (txn.prod_crs.camber_waviness) */
  camberWaviness?: string;
  /** Surface roughness Ra µm (txn.prod_crs.ra_um) */
  raUm?: number;
  /** Surface roughness Rz µm (txn.prod_crs.rz_um) */
  rzUm?: number;
  /** Output weight in MT (txn.prod_crs.output_wt_mt) */
  outputWtMt: number;
  /** Rejection OD in MT (txn.prod_crs.rejection_od_mt) */
  rejectionOdMt?: number;
  /** Rejection ID in MT (txn.prod_crs.rejection_id_mt) */
  rejectionIdMt?: number;
  /** Coating weight bright (txn.prod_crs.coating_wt_br) */
  coatingWtBr?: number;
  /** Coating weight matt (txn.prod_crs.coating_wt_matt) */
  coatingWtMatt?: number;
  /** RP oil grade coded reference to master.rp_oil_grade (txn.prod_crs.rp_oil_grade) */
  rpOilGrade?: string;
  /** Hold weight in MT (txn.prod_crs.hold_mt) */
  holdMt?: number;
  /** For-CTL weight in MT (txn.prod_crs.for_ctl_mt) */
  forCtlMt?: number;
  /** Slit slots A–D (txn.prod_crs_slit) */
  slitSlots: CRSSlitSlot[];
}

// ─── Cut-to-Length ────────────────────────────────────────────────────────────
// Maps to txn.prod_ctl
export interface CTLEntry extends BaseProcessEntry {
  /** Width in mm (txn.prod_ctl.width_mm) */
  widthMm: number;
  /** Thickness in mm (txn.prod_ctl.thk_mm) */
  thkMm: number;
  /** Weight in MT — kg input converted to MT (txn.prod_ctl.weight_mt) */
  weightMt: number;
  /** Nominal set length in mm (txn.prod_ctl.nominal_set_length_mm) */
  nominalSetLengthMm: number;
  /** Actual length in mm (txn.prod_ctl.actual_length_mm) */
  actualLengthMm: number;
  /** Number of pieces (txn.prod_ctl.no_pieces) */
  noPieces: number;
  /** Number of bundles (txn.prod_ctl.no_bundles) */
  noBundles: number;
  /** Total production in MT (txn.prod_ctl.total_prod_mt) */
  totalProdMt: number;
  /** Hold weight in MT (txn.prod_ctl.hold_mt) */
  holdMt?: number;
  /** Rejection weight in MT (txn.prod_ctl.rejection_mt) */
  rejectionMt?: number;
  /** Low speed indicator (txn.prod_ctl.low_speed) */
  lowSpeed?: string;
  /** Estimated suppressed (txn.prod_ctl.estimated_suppressed) */
  estimatedSuppressed?: string;
}
