import { z } from 'zod';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const timeHHmm = z
  .string()
  .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Time must be in HH:mm format')
  .optional();

// ─── Slit slot (HR Slitting) ──────────────────────────────────────────────────
// Maps to txn.prod_hrs_slit
export const HRSSlitSlotSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    if ((o.slot == null || o.slot === '') && typeof o.label === 'string') {
      return { ...o, slot: o.label };
    }
  }
  return raw;
}, z.object({
  // ponytail: reconcile to `slot` (plan §1); label aliases via preprocess
  slot: z.string().trim().min(1).max(8),
  label: z.string().trim().min(1).max(8).optional(),
  widthMm: z.number().positive('Width must be positive').optional(),
  targetWidthMm: z.number().positive().optional(),
  actualWidthMm: z.number().positive().optional(),
  thkMm: z.number().positive().optional(),
  plannedThkMm: z.number().positive().optional(),
  thkIdMm: z.number().positive().optional(),
  thkCentreMm: z.number().positive().optional(),
  thkOdMm: z.number().positive().optional(),
  plannedWeightMt: z.number().positive().optional(),
  actualWeightMt: z.number().positive().optional(),
  taper: z.string().optional(),
  childCoilNo: z.string().optional(),
  customer: z.string().optional(),
  sapBatchNumber: z.string().optional(),
  surfaceFinish: z.string().optional(),
  finishThicknessMm: z.number().positive().optional(),
  routeRaw: z.string().optional(),
  resolvedNextStep: z.string().optional(),
  downstreamCrsCombination: z.string().optional(),
  holdFlag: z.boolean().optional(),
  forCtlFlag: z.boolean().optional(),
}).superRefine((data, ctx) => {
  const w = data.targetWidthMm ?? data.widthMm;
  if (w == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Width required', path: ['widthMm'] });
  }
}));
export const SlitSlotSchema = HRSSlitSlotSchema;

// ─── Slit slot (CR Slitting) ──────────────────────────────────────────────────
// Maps to txn.prod_crs_slit
export const CRSSlitSlotSchema = z.object({
  label: z.enum(['A', 'B', 'C', 'D', 'E']),
  widthMm: z.number().positive('Width must be positive'),
  childCoilNo: z.string().optional(),
  slitNo: z.string().optional(),
  finishWidthMm: z.number().positive().optional(),
  noOfSlit: z.number().int().positive().optional(),
  actualWidthMm: z.number().positive().optional(),
  actualThkFrontMm: z.number().positive().optional(),
  actualThkRearMm: z.number().positive().optional(),
  outputWtMt: z.number().positive().optional(),
  scrapMt: z.number().min(0).optional(),
  rejectionOdMt: z.number().min(0).optional(),
  rejectionIdMt: z.number().min(0).optional(),
  holdFlag: z.boolean().optional(),
  forCtlFlag: z.boolean().optional(),
  routeCode: z.string().optional(),
  sapBatchNumber: z.string().optional(),
  camberWaviness: z.string().optional(),
  raUm: z.number().optional(),
  rzUm: z.number().optional(),
});

// ─── Base process entry ───────────────────────────────────────────────────────

export const BaseProcessEntrySchema = z.object({
  id: z.string().min(1, 'ID is required'),
  shiftLogId: z.string().min(1, 'Shift Log ID is required'),
  coilNo: z.string().min(1, 'Coil Number is required'),
  slNo: z.number().int().positive().optional(),
  timeFrom: timeHHmm,
  timeTo: timeHHmm,
  remarks: z.string().optional(),
});

// ─── HR Slitting ─────────────────────────────────────────────────────────────
// Maps to txn.prod_hrs (+txn.prod_hrs_slit)
// Req 12.8: add actual_slit_width_from/to_mm, time_from/to; slit slot = {A–D, width, thickness, taper, child_coil_no}
export const HRSSchema = BaseProcessEntrySchema.extend({
  nominalWidthMm: z.number().positive(),
  actualWidthMm: z.number().positive(),
  nominalThkMm: z.number().positive(),
  weightMt: z.number().positive(),
  scrapMt: z.number().min(0),
  // scrapPct is derived — not captured
  actualSlitWidthFromMm: z.number().positive().optional(),
  actualSlitWidthToMm: z.number().positive().optional(),
  slitSlots: z.array(HRSSlitSlotSchema).max(12, 'Practical UI cap 12 slits'),
}).superRefine((data, ctx) => {
  if (data.actualWidthMm > data.nominalWidthMm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Actual width cannot exceed nominal width',
      path: ['actualWidthMm'],
    });
  }
  if (
    data.actualSlitWidthFromMm !== undefined &&
    data.actualSlitWidthToMm !== undefined &&
    data.actualSlitWidthFromMm > data.actualSlitWidthToMm
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Actual slit width from must be ≤ actual slit width to',
      path: ['actualSlitWidthFromMm'],
    });
  }
  // Slot labels must be unique
  const labels = data.slitSlots.map((s) => s.slot || s.label);
  if (new Set(labels).size !== labels.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Slit slot labels must be unique',
      path: ['slitSlots'],
    });
  }
  // Req: Sum of slit widths cannot exceed nominal width
  const sumSlitWidths = data.slitSlots.reduce((sum, slot) => sum + (slot.targetWidthMm ?? slot.widthMm ?? 0), 0);
  if (sumSlitWidths > data.nominalWidthMm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Sum of slit widths cannot exceed the nominal width of the parent coil',
      path: ['slitSlots'],
    });
  }
});

// ─── Pickling – coil log ──────────────────────────────────────────────────────
// Maps to txn.prod_pkl
// Req 12.3: wip/leader_end as coded/text (not boolean); add time_from/to
export const PKLSchema = BaseProcessEntrySchema.extend({
  widthMm: z.number().positive(),
  thkMm: z.number().positive(),
  weightMt: z.number().positive(),
  ppcWeightMt: z.number().positive().optional(),
  lineSpeedMpm: z.number().positive(),
  heatNo: z.string().min(1, 'Heat number is required'),
  source: z.string(),
  wip: z.string().optional(),
  leaderEnd: z.string().optional(),
  repeats: z.number().int().nonnegative().optional(),
  wp: z.enum(['W', 'P']).optional(),
  endFilling: z.boolean().optional(),
  ht: z.string().optional(),
  motherCoilNo: z.string().optional(),
  slitId: z.string().optional(),
  customer: z.string().optional(),
  gradeCode: z.string().optional(),
  routeRaw: z.string().optional(),
  status: z.string().optional(),
  crewRef: z.string().optional(),
  totalTimeMin: z.number().optional(),
});

// ─── Pickling – hourly process chart ─────────────────────────────────────────
// Maps to txn.prod_pkl_chart
// Req 12.2: keyed by tank_no ∈ {1,2,3}; full chemistry block
export const PKLChartRowSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  shiftLogId: z.string().min(1, 'Shift Log ID is required'),
  chartTime: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Time must be in HH:mm format'),
  tankNo: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  tankLevel: z.number().min(0).optional(),
  tankTempDegC: z.number().optional(),
  acidStrengthPct: z.number().min(0).max(100).optional(),
  ironStrengthPct: z.number().min(0).max(100).optional(),
  steamInletKgCm2: z.number().min(0).optional(),
  steamOutletKgCm2: z.number().min(0).optional(),
  dosageAcid: z.number().min(0).optional(),
  dosageWater: z.number().min(0).optional(),
  dosageInhibitor: z.number().min(0).optional(),
  rinseCl: z.number().min(0).optional(),
  rinsePh: z.number().min(0).max(14).optional(),
  rinseFlow: z.number().min(0).optional(),
  rinseTempDegC: z.number().optional(),
  rinseAcidPct: z.number().min(0).max(100).optional(),
  rinseIronPct: z.number().min(0).max(100).optional(),
  burnerPressureKgCm2: z.number().min(0).optional(),
  hotAirTempDegC: z.number().optional(),
});

// ─── Cold Rolling Mill ────────────────────────────────────────────────────────
// Maps to txn.prod_crm
// Req 12.4: replace booleans with ann_hardness, hardness_vpn/hrb, roll_in/out,
//           oil_level_initial/final, oil_consumption, rw_tension_kg, tkg_weight_mt
export const CRMSchema = BaseProcessEntrySchema.extend({
  widthMm: z.number().positive(),
  inputThkMm: z.number().positive(),
  outputThkMm: z.number().positive(),
  weightMt: z.number().positive(),
  annHardness: z.number().positive().optional(),
  hardnessVpn: z.number().positive().optional(),
  hardnessHrb: z.number().positive().optional(),
  rollIn: z.string().optional(),
  rollOut: z.string().optional(),
  oilLevelInitial: z.number().min(0).optional(),
  oilLevelFinal: z.number().min(0).optional(),
  oilConsumption: z.number().min(0).optional(),
  rwTensionKg: z.number().positive().optional(),
  tkgWeightMt: z.number().positive().optional(),
  elongationPct: z.number().min(0).max(100).optional(),
  lossPct: z.number().min(0).max(100).optional(),
  stretchPct: z.number().min(0).max(100).optional(),
  scrapMt: z.number().min(0).optional(),
}).superRefine((data, ctx) => {
  if (data.outputThkMm >= data.inputThkMm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Output thickness must be strictly less than input thickness',
      path: ['outputThkMm'],
    });
  }
  if (
    data.oilLevelInitial !== undefined &&
    data.oilLevelFinal !== undefined &&
    data.oilLevelFinal > data.oilLevelInitial
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Oil level final cannot exceed oil level initial',
      path: ['oilLevelFinal'],
    });
  }
});

// ─── Annealing ────────────────────────────────────────────────────────────────
// Maps to txn.ann_charge
// Req 12.7: add dew_point_n2/h2, loading_mt/unloading_mt, cumm_loading/unloading_mt,
//           status ∈ {IN_PROCESS,FOR_ANN,RW,DONE}; chargeWtMt is derived — not captured
export const ANNSchema = BaseProcessEntrySchema.extend({
  chargeNo: z.string().min(1),
  baseNo: z.string().min(1),
  furnaceId: z.number().int().positive(),
  gradeCode: z.string().min(1),
  noOfCoils: z.number().int().positive(),
  // chargeWtMt is derived (sum of coil weights) — not captured
  status: z.enum(['IN_PROCESS', 'FOR_ANN', 'RW', 'DONE']).optional(),
  dewPointN2: z.number().optional(),
  dewPointH2: z.number().optional(),
  temperatureDegC: z.number().optional(),
  expUnloadingTime: z.string().optional(), // ISO timestamp string
  unloadingWtMt: z.number().min(0).optional(),
  loadingMt: z.number().min(0).optional(),
  unloadingMt: z.number().min(0).optional(),
  cummLoadingMt: z.number().min(0).optional(),
  cummUnloadingMt: z.number().min(0).optional(),
  oxygenPct: z.number().min(0).max(100).optional(),
}).superRefine((data, ctx) => {
  if (data.oxygenPct !== undefined && data.oxygenPct >= 0.5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Oxygen (O2) concentration must be below 0.5% to safely start the heating cycle',
      path: ['oxygenPct'],
    });
  }
});

// ─── Skin Pass ────────────────────────────────────────────────────────────────
// Maps to txn.prod_skp (+txn.prod_skp_pass)
// Req 12.5, 12.6: pass carries {pass_no ∈ 1..6, thickness_mm} only — no per-pass tension
export const SKPPassSchema = z.object({
  passNo: z
    .number()
    .int()
    .min(1, 'Pass number must be between 1 and 6')
    .max(6, 'Pass number must be between 1 and 6'),
  thicknessMm: z.number().positive(),
});

export const SKPSchema = BaseProcessEntrySchema.extend({
  widthMm: z.number().positive(),
  thkMm: z.number().positive(),
  finalThkMm: z.number().positive(),
  totalPasses: z.number().int().min(1).max(6).optional(),
  weightMt: z.number().positive(),
  rwTensionKg: z.number().positive().optional(),
  surfaceFinish: z.string().min(1),
  reRolling: z.boolean(),
  holdMt: z.number().min(0).optional(),
  rejectionMt: z.number().min(0).optional(),
  wtRollingMt: z.number().min(0).optional(),
  wtRerollMt: z.number().min(0).optional(),
  wtSkinpassMt: z.number().min(0).optional(),
  wtScrapMt: z.number().min(0).optional(),
  rollsIn: z.string().optional(),
  rollsOut: z.string().optional(),
  coolantTempDegC: z.number().optional(),
  coolantPressKgCm2: z.number().min(0).optional(),
  passes: z.array(SKPPassSchema).max(6),
}).superRefine((data, ctx) => {
  const passNos = data.passes.map((p) => p.passNo);
  if (new Set(passNos).size !== passNos.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Pass numbers must be unique within an entry',
      path: ['passes'],
    });
  }
  if (data.finalThkMm >= data.thkMm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Final thickness must be strictly less than input thickness',
      path: ['finalThkMm'],
    });
  }
});

// ─── Rewinding ────────────────────────────────────────────────────────────────
// Maps to txn.prod_rwd
// Confirm: 3 tensions + output_thk
export const RWDSchema = BaseProcessEntrySchema.extend({
  widthMm: z.number().positive(),
  thkMm: z.number().positive(),
  outputThkMm: z.number().positive(),
  weightMt: z.number().positive(),
  rwTension1Kg: z.number().positive().optional(),
  rwTension2Kg: z.number().positive().optional(),
  rwTension3Kg: z.number().positive().optional(),
  surfaceFinish: z.string().min(1),
}).superRefine((data, ctx) => {
  if (data.outputThkMm >= data.thkMm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Output thickness must be strictly less than input thickness',
      path: ['outputThkMm'],
    });
  }
});

// ─── CR Slitter ───────────────────────────────────────────────────────────────
// Maps to txn.prod_crs (+txn.prod_crs_slit)
// Req 12.3: restore full quality block; rp_oil_grade as coded reference
export const CRSSchema = BaseProcessEntrySchema.extend({
  slitNo: z.string().min(1),
  coilWidthMm: z.number().positive(),
  nominalThkMm: z.number().positive(),
  actualWidthMm: z.number().positive().optional(),
  actualThkFrontMm: z.number().positive().optional(),
  actualThkRearMm: z.number().positive().optional(),
  hardnessVpn: z.number().positive().optional(),
  hardnessHrb: z.number().positive().optional(),
  ibTiecv: z.string().optional(),
  utsNmm2: z.number().positive().optional(),
  elongationPct: z.number().positive().optional(),
  ysrBurr: z.string().optional(),
  camberWaviness: z.string().optional(),
  raUm: z.number().positive().optional(),   // ra_um — not boolean
  rzUm: z.number().positive().optional(),   // rz_um — not boolean
  outputWtMt: z.number().positive(),
  rejectionOdMt: z.number().min(0).optional(),
  rejectionIdMt: z.number().min(0).optional(),
  coatingWtBr: z.number().min(0).optional(),
  coatingWtMatt: z.number().min(0).optional(),
  rpOilGrade: z.string().optional(),        // coded reference to master.rp_oil_grade — not boolean
  holdMt: z.number().min(0).optional(),
  forCtlMt: z.number().min(0).optional(),
  slitSlots: z.array(CRSSlitSlotSchema).max(5, 'Maximum of 5 slit slots (A–E) allowed'),
});

// ─── Cut-to-Length ────────────────────────────────────────────────────────────
// Maps to txn.prod_ctl
// Req 3.10: weight stored in MT (kg input converted); hold_mt is numeric, not boolean
export const CTLSchema = BaseProcessEntrySchema.extend({
  widthMm: z.number().positive(),
  thkMm: z.number().positive(),
  weightMt: z.number().positive(),           // stored MT (kg input converted)
  nominalSetLengthMm: z.number().positive(),
  actualLengthMm: z.number().positive(),
  noPieces: z.number().int().positive(),
  noBundles: z.number().int().positive(),
  totalProdMt: z.number().positive(),
  holdMt: z.number().min(0).optional(),      // hold_mt NUMERIC — not boolean
  rejectionMt: z.number().min(0).optional(),
  lowSpeed: z.string().optional(),
  estimatedSuppressed: z.string().optional(),
  squarenessCheckDone: z.boolean().optional(),
}).superRefine((data, ctx) => {
  // Squareness reminder every 50 pieces
  if (data.noPieces >= 50 && data.noPieces % 50 === 0) {
    if (!data.squarenessCheckDone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A physical squareness measurement must be confirmed every 50 pieces',
        path: ['squarenessCheckDone'],
      });
    }
  }
});


// ─── Process schema registry ──────────────────────────────────────────────────

/** Maps canonical process codes to their Zod schemas. */
export const ProcessSchemas: Record<string, z.ZodTypeAny> = {
  HRS: HRSSchema,
  PKL: PKLSchema,
  CRM: CRMSchema,
  ANN: ANNSchema,
  SKP: SKPSchema,
  RWD: RWDSchema,
  CRS: CRSSchema,
  CTL: CTLSchema,
};

/** Additional schemas for sub-entities (chart rows, passes, slit slots). */
export const AdditionalSchemas = {
  PKLChartRow: PKLChartRowSchema,
  SKPPass: SKPPassSchema,
  HRSSlitSlot: HRSSlitSlotSchema,
  CRSSlitSlot: CRSSlitSlotSchema,
};
