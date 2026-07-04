import { z } from 'zod';

const optionalNumber = z.coerce.number().finite().optional();
const optionalPositiveNumber = z.coerce.number().positive().optional();
const optionalString = z.string().trim().optional();
const requiredString = z.string().trim().min(1);
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

export const baseProcessEntrySchema = z.object({
  id: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  machineCode: requiredString,
  shiftLogId: requiredString,
  coilNo: requiredString,
  createdAt: z.string().datetime().optional(),
  createdBy: z.string().optional(),
  slNo: z.coerce.number().int().positive().optional(),
  timeFrom: timeString.optional(),
  timeTo: timeString.optional(),
  remarks: optionalString,
});

export const hrsSlitSlotSchema = z.object({
  slot: z.enum(['A', 'B', 'C', 'D']),
  widthMm: optionalPositiveNumber,
  thkMm: optionalPositiveNumber,
  taper: optionalString,
  childCoilNo: optionalString,
});

export const crsSlitSlotSchema = z.object({
  slot: z.enum(['A', 'B', 'C', 'D']),
  widthMm: optionalPositiveNumber,
  childCoilNo: optionalString,
});

export const skpPassSchema = z.object({
  passNo: z.coerce.number().int().min(1).max(6),
  thicknessMm: optionalPositiveNumber,
});

export const pklChartRowSchema = z.object({
  chartTime: timeString,
  tankNo: z.coerce.number().int().min(1).max(3).optional(),
  tankLevel: optionalNumber,
  tankTempDegc: optionalNumber,
  acidStrengthPct: optionalNumber,
  ironStrengthPct: optionalNumber,
  steamInletKgcm2: optionalNumber,
  steamOutletKgcm2: optionalNumber,
  dosageAcid: optionalNumber,
  dosageWater: optionalNumber,
  dosageInhibitor: optionalNumber,
  rinseCl: optionalNumber,
  rinsePh: optionalNumber,
  rinseFlow: optionalNumber,
  rinseTempDegc: optionalNumber,
  rinseAcidPct: optionalNumber,
  rinseIronPct: optionalNumber,
  burnerPressureKgcm2: optionalNumber,
  hotAirTempDegc: optionalNumber,
});

export const hrsSchema = baseProcessEntrySchema.extend({
  nominalWidthMm: optionalPositiveNumber,
  actualWidthMm: optionalPositiveNumber,
  nominalThkMm: optionalPositiveNumber,
  weightMt: optionalPositiveNumber,
  actualSlitWidthFromMm: optionalPositiveNumber,
  actualSlitWidthToMm: optionalPositiveNumber,
  scrapMt: optionalNumber,
  scrapPct: optionalNumber,
  slitSlots: z.array(hrsSlitSlotSchema).optional(),
});

export const pklSchema = baseProcessEntrySchema.extend({
  widthMm: optionalPositiveNumber,
  thkMm: optionalPositiveNumber,
  weightMt: optionalPositiveNumber,
  lineSpeedMpm: optionalPositiveNumber,
  heatNo: optionalString,
  source: optionalString,
  wip: optionalString,
  leaderEnd: optionalString,
  charts: z.array(pklChartRowSchema).optional(),
});

export const annSchema = baseProcessEntrySchema.extend({
  chargeNo: requiredString,
  baseNo: optionalString,
  furnaceId: z.coerce.number().int().positive().optional(),
  gradeCode: optionalString,
  noOfCoils: z.coerce.number().int().positive().optional(),
  chargeWtMt: optionalPositiveNumber,
  status: z.enum(['IN_PROCESS', 'FOR_ANN', 'RW', 'DONE']).default('IN_PROCESS'),
  dewPointN2: optionalNumber,
  dewPointH2: optionalNumber,
  temperatureDegc: optionalNumber,
  expUnloadingTime: z.string().datetime().optional(),
  unloadingWtMt: optionalNumber,
  loadingMt: optionalNumber,
  unloadingMt: optionalNumber,
  cummLoadingMt: optionalNumber,
  cummUnloadingMt: optionalNumber,
});

export const skpSchema = baseProcessEntrySchema.extend({
  widthMm: optionalPositiveNumber,
  thkMm: optionalPositiveNumber,
  finalThkMm: optionalPositiveNumber,
  totalPasses: z.coerce.number().int().min(1).max(6).optional(),
  weightMt: optionalPositiveNumber,
  rwTensionKg: optionalNumber,
  surfaceFinish: optionalString,
  reRolling: z.boolean().optional(),
  holdMt: optionalNumber,
  rejectionMt: optionalNumber,
  wtRollingMt: optionalNumber,
  wtRerollMt: optionalNumber,
  wtSkinpassMt: optionalNumber,
  wtScrapMt: optionalNumber,
  rollsIn: optionalString,
  rollsOut: optionalString,
  coolantTempDegc: optionalNumber,
  coolantPressKgcm2: optionalNumber,
  passes: z.array(skpPassSchema).optional(),
});

export const rwdSchema = baseProcessEntrySchema.extend({
  widthMm: optionalPositiveNumber,
  thkMm: optionalPositiveNumber,
  outputThkMm: optionalPositiveNumber,
  weightMt: optionalPositiveNumber,
  rwTension1Kg: optionalNumber,
  rwTension2Kg: optionalNumber,
  rwTension3Kg: optionalNumber,
  surfaceFinish: optionalString,
});

export const crsSchema = baseProcessEntrySchema.extend({
  slitNo: optionalString,
  coilWidthMm: optionalPositiveNumber,
  nominalThkMm: optionalPositiveNumber,
  actualWidthMm: optionalPositiveNumber,
  actualThkFrontMm: optionalPositiveNumber,
  actualThkRearMm: optionalPositiveNumber,
  hardnessVpn: optionalNumber,
  hardnessHrb: optionalNumber,
  ibTiecv: optionalString,
  utsNmm2: optionalNumber,
  elongationPct: optionalNumber,
  ysrBurr: optionalString,
  camberWaviness: optionalString,
  raUm: optionalNumber,
  rzUm: optionalNumber,
  outputWtMt: optionalPositiveNumber,
  rejectionOdMt: optionalNumber,
  rejectionIdMt: optionalNumber,
  coatingWtBr: optionalNumber,
  coatingWtMatt: optionalNumber,
  rpOilGrade: optionalString,
  holdMt: optionalNumber,
  forCtlMt: optionalNumber,
  slitSlots: z.array(crsSlitSlotSchema).optional(),
});

export const ctlSchema = baseProcessEntrySchema.extend({
  widthMm: optionalPositiveNumber,
  thkMm: optionalPositiveNumber,
  weightMt: optionalPositiveNumber,
  nominalSetLengthMm: optionalPositiveNumber,
  actualLengthMm: optionalPositiveNumber,
  noPieces: z.coerce.number().int().nonnegative().optional(),
  noBundles: z.coerce.number().int().nonnegative().optional(),
  totalProdMt: optionalNumber,
  holdMt: optionalNumber,
  rejectionMt: optionalNumber,
  lowSpeed: optionalString,
  estimatedSuppressed: optionalString,
});

export type M1BaseProcessForm = z.infer<typeof baseProcessEntrySchema>;
export type M1HRSSlitSlotForm = z.infer<typeof hrsSlitSlotSchema>;
export type M1CRSSlitSlotForm = z.infer<typeof crsSlitSlotSchema>;
export type M1SKPPassForm = z.infer<typeof skpPassSchema>;
export type M1PKLChartRowForm = z.infer<typeof pklChartRowSchema>;
export type M1HRSForm = z.infer<typeof hrsSchema>;
export type M1PKLForm = z.infer<typeof pklSchema>;
export type M1ANNForm = z.infer<typeof annSchema>;
export type M1SKPForm = z.infer<typeof skpSchema>;
export type M1RWDForm = z.infer<typeof rwdSchema>;
export type M1CRSForm = z.infer<typeof crsSchema>;
export type M1CTLForm = z.infer<typeof ctlSchema>;
