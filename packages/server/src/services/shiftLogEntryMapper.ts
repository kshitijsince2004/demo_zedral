/**
 * Maps txn.* DB rows (snake_case) into shared-validation payloads (camelCase).
 */

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function baseEntry(row: Record<string, unknown>, shiftLogId: string, idField = 'entry_id') {
  const id = row[idField] ?? row.charge_no ?? row.coil_no;
  return {
    id: String(id),
    shiftLogId,
    coilNo: str(row.coil_no) ?? str(row.charge_no) ?? '',
    slNo: row.sl_no != null ? Number(row.sl_no) : undefined,
    timeFrom: str(row.time_from),
    timeTo: str(row.time_to),
    remarks: str(row.remarks),
  };
}

export function mapHrsEntry(row: Record<string, unknown>, shiftLogId: string, slits: Record<string, unknown>[]) {
  return {
    ...baseEntry(row, shiftLogId),
    nominalWidthMm: num(row.nominal_width_mm)!,
    actualWidthMm: num(row.actual_width_mm)!,
    nominalThkMm: num(row.nominal_thk_mm)!,
    weightMt: num(row.weight_mt)!,
    scrapMt: num(row.scrap_mt) ?? 0,
    actualSlitWidthFromMm: num(row.actual_slit_width_from_mm),
    actualSlitWidthToMm: num(row.actual_slit_width_to_mm),
    slitSlots: slits.map((s) => ({
      label: str(s.slot) as 'A' | 'B' | 'C' | 'D',
      widthMm: num(s.width_mm)!,
      thkMm: num(s.thk_mm),
      taper: str(s.taper),
      childCoilNo: str(s.child_coil_no),
    })),
  };
}

export function mapPklEntry(row: Record<string, unknown>, shiftLogId: string) {
  return {
    ...baseEntry(row, shiftLogId),
    widthMm: num(row.width_mm)!,
    thkMm: num(row.thk_mm)!,
    weightMt: num(row.weight_mt)!,
    lineSpeedMpm: num(row.line_speed_mpm)!,
    heatNo: str(row.heat_no) ?? '',
    source: str(row.source) ?? '',
    wip: str(row.wip),
    leaderEnd: str(row.leader_end),
  };
}

export function mapCrmEntry(row: Record<string, unknown>, shiftLogId: string) {
  return {
    ...baseEntry(row, shiftLogId),
    widthMm: num(row.width_mm)!,
    inputThkMm: num(row.input_thk_mm)!,
    outputThkMm: num(row.output_thk_mm)!,
    weightMt: num(row.weight_mt)!,
    annHardness: num(row.ann_hardness),
    hardnessVpn: num(row.hardness_vpn),
    hardnessHrb: num(row.hardness_hrb),
    rollIn: str(row.roll_in),
    rollOut: str(row.roll_out),
    oilLevelInitial: num(row.oil_level_initial),
    oilLevelFinal: num(row.oil_level_final),
    oilConsumption: num(row.oil_consumption),
    rwTensionKg: num(row.rw_tension_kg),
    tkgWeightMt: num(row.tkg_weight_mt),
    elongationPct: num(row.elongation_pct),
    lossPct: num(row.loss_pct),
    stretchPct: num(row.stretch_pct),
    scrapMt: num(row.scrap_mt),
  };
}

export function mapAnnEntry(row: Record<string, unknown>, shiftLogId: string) {
  return {
    ...baseEntry(row, shiftLogId, 'charge_no'),
    chargeNo: str(row.charge_no) ?? '',
    baseNo: str(row.base_no) ?? '',
    furnaceId: Number(row.furnace_id),
    gradeCode: str(row.grade_code) ?? '',
    noOfCoils: Number(row.no_of_coils),
    status: str(row.status) as 'PREPARING' | 'IN_PROCESS' | 'FOR_ANN' | 'RW' | 'DONE' | undefined,
    dewPointN2: num(row.dew_point_n2),
    dewPointH2: num(row.dew_point_h2),
    temperatureDegC: num(row.temperature_degc),
    expUnloadingTime: row.exp_unloading_time ? new Date(String(row.exp_unloading_time)).toISOString() : undefined,
    unloadingWtMt: num(row.unloading_wt_mt),
    loadingMt: num(row.loading_mt),
    unloadingMt: num(row.unloading_mt),
    cummLoadingMt: num(row.cumm_loading_mt),
    cummUnloadingMt: num(row.cumm_unloading_mt),
    oxygenPct: num(row.oxygen_pct),
  };
}

export function mapSkpEntry(row: Record<string, unknown>, shiftLogId: string, passes: Record<string, unknown>[]) {
  return {
    ...baseEntry(row, shiftLogId),
    widthMm: num(row.width_mm)!,
    thkMm: num(row.thk_mm)!,
    finalThkMm: num(row.final_thk_mm)!,
    totalPasses: row.total_passes != null ? Number(row.total_passes) : undefined,
    weightMt: num(row.weight_mt)!,
    rwTensionKg: num(row.rw_tension_kg),
    surfaceFinish: str(row.surface_finish) ?? '',
    reRolling: Boolean(row.re_rolling),
    holdMt: num(row.hold_mt),
    rejectionMt: num(row.rejection_mt),
    wtRollingMt: num(row.wt_rolling_mt),
    wtRerollMt: num(row.wt_reroll_mt),
    wtSkinpassMt: num(row.wt_skinpass_mt),
    wtScrapMt: num(row.wt_scrap_mt),
    rollsIn: str(row.rolls_in),
    rollsOut: str(row.rolls_out),
    coolantTempDegC: num(row.coolant_temp_degc),
    coolantPressKgCm2: num(row.coolant_press_kgcm2),
    passes: passes.map((p) => ({
      passNo: Number(p.pass_no),
      thicknessMm: num(p.thickness_mm)!,
    })),
  };
}

export function mapRwdEntry(row: Record<string, unknown>, shiftLogId: string) {
  return {
    ...baseEntry(row, shiftLogId),
    widthMm: num(row.width_mm)!,
    thkMm: num(row.thk_mm)!,
    outputThkMm: num(row.output_thk_mm)!,
    weightMt: num(row.weight_mt)!,
    rwTension1Kg: num(row.rw_tension_1_kg),
    rwTension2Kg: num(row.rw_tension_2_kg),
    rwTension3Kg: num(row.rw_tension_3_kg),
    surfaceFinish: str(row.surface_finish) ?? '',
  };
}

export function mapCrsEntry(row: Record<string, unknown>, shiftLogId: string, slits: Record<string, unknown>[]) {
  return {
    ...baseEntry(row, shiftLogId),
    slitNo: str(row.slit_no) ?? '',
    coilWidthMm: num(row.coil_width_mm)!,
    nominalThkMm: num(row.nominal_thk_mm)!,
    actualWidthMm: num(row.actual_width_mm),
    actualThkFrontMm: num(row.actual_thk_front_mm),
    actualThkRearMm: num(row.actual_thk_rear_mm),
    hardnessVpn: num(row.hardness_vpn),
    hardnessHrb: num(row.hardness_hrb),
    ibTiecv: str(row.ib_tiecv),
    utsNmm2: num(row.uts_nmm2),
    elongationPct: num(row.elongation_pct),
    ysrBurr: str(row.ysr_burr),
    camberWaviness: str(row.camber_waviness),
    raUm: num(row.ra_um),
    rzUm: num(row.rz_um),
    outputWtMt: num(row.output_wt_mt)!,
    rejectionOdMt: num(row.rejection_od_mt),
    rejectionIdMt: num(row.rejection_id_mt),
    coatingWtBr: num(row.coating_wt_br),
    coatingWtMatt: num(row.coating_wt_matt),
    rpOilGrade: str(row.rp_oil_grade),
    holdMt: num(row.hold_mt),
    forCtlMt: num(row.for_ctl_mt),
    slitSlots: slits.map((s) => ({
      label: str(s.slot) as 'A' | 'B' | 'C' | 'D',
      widthMm: num(s.width_mm)!,
      childCoilNo: str(s.child_coil_no),
    })),
  };
}

export function mapCtlEntry(row: Record<string, unknown>, shiftLogId: string) {
  return {
    ...baseEntry(row, shiftLogId),
    widthMm: num(row.width_mm)!,
    thkMm: num(row.thk_mm)!,
    weightMt: num(row.weight_mt)!,
    nominalSetLengthMm: num(row.nominal_set_length_mm)!,
    actualLengthMm: num(row.actual_length_mm)!,
    noPieces: Number(row.no_pieces),
    noBundles: Number(row.no_bundles),
    totalProdMt: num(row.total_prod_mt)!,
    holdMt: num(row.hold_mt),
    rejectionMt: num(row.rejection_mt),
    lowSpeed: str(row.low_speed),
    estimatedSuppressed: str(row.estimated_suppressed),
  };
}

