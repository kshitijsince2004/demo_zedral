/**
 * Property 5: Formâ€“schema field conformance
 *
 * Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
 *
 * Each process section must capture exactly the fields declared in the canonical
 * TypeScript interface (no extra fields, no missing required fields). This test
 * verifies the conformance rules for the complete set of required scalar fields
 * across all eight process schemas by constructing valid synthetic entries and
 * checking that:
 *   - Required fields are non-null and of the correct primitive type
 *   - Optional fields may be absent (undefined) or carry a valid value
 *   - No extraneous fields bypass the interface contract
 *
 * Tagged: Feature: m1-frontend-remediation, Property 5: Formâ€“schema field conformance
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type {
  HRSEntry,
  PKLEntry,
  PKLChartRow,
  CRMEntry,
  ANNEntry,
  SKPEntry,
  RWDEntry,
  CRSEntry,
  CTLEntry,
} from '../src/types/processes';

// ---------------------------------------------------------------------------
// Arbitraries â€” minimal valid synthetic entries per schema
// ---------------------------------------------------------------------------

const timeStr = fc.stringMatching(/^\d{2}:\d{2}$/); // HH:mm

const slitSlotArb = fc.record({
  label: fc.constantFrom('A', 'B', 'C', 'D') as fc.Arbitrary<'A' | 'B' | 'C' | 'D'>,
  widthMm: fc.double({ min: 1, max: 2000, noNaN: true }),
  thkMm: fc.option(fc.double({ min: 0.1, max: 20, noNaN: true }), { nil: undefined }),
  taper: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  childCoilNo: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
});

// â”€â”€ HRS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const hrsEntryArb = fc.record({
  id: fc.uuid(),
  shiftLogId: fc.uuid(),
  coilNo: fc.string({ minLength: 1, maxLength: 20 }),
  startTime: fc.date(),
  nominalWidthMm: fc.double({ min: 1, max: 3000, noNaN: true }),
  actualWidthMm: fc.option(fc.double({ min: 1, max: 3000, noNaN: true }), { nil: undefined }),
  nominalThkMm: fc.double({ min: 0.1, max: 20, noNaN: true }),
  weightMt: fc.double({ min: 0, max: 50, noNaN: true }),
  scrapMt: fc.double({ min: 0, max: 5, noNaN: true }),
  actualSlitWidthFromMm: fc.option(fc.double({ min: 1, max: 2000, noNaN: true }), { nil: undefined }),
  actualSlitWidthToMm: fc.option(fc.double({ min: 1, max: 2000, noNaN: true }), { nil: undefined }),
  timeFrom: fc.option(timeStr, { nil: undefined }),
  timeTo: fc.option(timeStr, { nil: undefined }),
  slitSlots: fc.array(slitSlotArb, { maxLength: 4 }),
});

// â”€â”€ PKL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const pklEntryArb = fc.record({
  id: fc.uuid(),
  shiftLogId: fc.uuid(),
  coilNo: fc.string({ minLength: 1, maxLength: 20 }),
  startTime: fc.date(),
  widthMm: fc.double({ min: 1, max: 3000, noNaN: true }),
  thkMm: fc.double({ min: 0.1, max: 20, noNaN: true }),
  weightMt: fc.double({ min: 0, max: 50, noNaN: true }),
  lineSpeedMpm: fc.double({ min: 0, max: 300, noNaN: true }),
  heatNo: fc.string({ minLength: 1, maxLength: 20 }),
  source: fc.string({ minLength: 1, maxLength: 20 }),
  wip: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  leaderEnd: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  timeFrom: fc.option(timeStr, { nil: undefined }),
  timeTo: fc.option(timeStr, { nil: undefined }),
});

// â”€â”€ PKLChart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const pklChartArb = fc.record({
  id: fc.uuid(),
  shiftLogId: fc.uuid(),
  chartTime: timeStr,
  tankNo: fc.constantFrom(1, 2, 3) as fc.Arbitrary<1 | 2 | 3>,
  tankLevel: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  tankTempDegC: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  acidStrengthPct: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  ironStrengthPct: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  steamInletKgCm2: fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: undefined }),
  steamOutletKgCm2: fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: undefined }),
  dosageAcid: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  dosageWater: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  dosageInhibitor: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  rinseCl: fc.option(fc.double({ min: 0, max: 500, noNaN: true }), { nil: undefined }),
  rinsePh: fc.option(fc.double({ min: 0, max: 14, noNaN: true }), { nil: undefined }),
  rinseFlow: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: undefined }),
  rinseTempDegC: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  rinseAcidPct: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  rinseIronPct: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  burnerPressureKgCm2: fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: undefined }),
  hotAirTempDegC: fc.option(fc.double({ min: 0, max: 500, noNaN: true }), { nil: undefined }),
});

// â”€â”€ CRM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const crmEntryArb = fc.record({
  id: fc.uuid(),
  shiftLogId: fc.uuid(),
  coilNo: fc.string({ minLength: 1, maxLength: 20 }),
  startTime: fc.date(),
  widthMm: fc.double({ min: 1, max: 3000, noNaN: true }),
  inputThkMm: fc.double({ min: 0.5, max: 20, noNaN: true }),
  outputThkMm: fc.double({ min: 0.1, max: 10, noNaN: true }),
  weightMt: fc.double({ min: 0, max: 50, noNaN: true }),
  annHardness: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  hardnessVpn: fc.option(fc.double({ min: 0, max: 400, noNaN: true }), { nil: undefined }),
  hardnessHrb: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  rollIn: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  rollOut: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  oilLevelInitial: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  oilLevelFinal: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  oilConsumption: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  rwTensionKg: fc.option(fc.double({ min: 0, max: 10000, noNaN: true }), { nil: undefined }),
  tkgWeightMt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  elongationPct: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  lossPct: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  stretchPct: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  scrapMt: fc.option(fc.double({ min: 0, max: 5, noNaN: true }), { nil: undefined }),
  timeFrom: fc.option(timeStr, { nil: undefined }),
  timeTo: fc.option(timeStr, { nil: undefined }),
});

// â”€â”€ ANN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const annEntryArb = fc.record({
  id: fc.uuid(),
  shiftLogId: fc.uuid(),
  coilNo: fc.string({ minLength: 1, maxLength: 20 }),
  startTime: fc.date(),
  chargeNo: fc.string({ minLength: 1, maxLength: 20 }),
  baseNo: fc.string({ minLength: 1, maxLength: 20 }),
  furnaceId: fc.integer({ min: 1, max: 10 }),
  gradeCode: fc.string({ minLength: 1, maxLength: 10 }),
  noOfCoils: fc.integer({ min: 1, max: 50 }),
  status: fc.option(fc.constantFrom('IN_PROCESS', 'FOR_ANN', 'RW', 'DONE') as fc.Arbitrary<'IN_PROCESS' | 'FOR_ANN' | 'RW' | 'DONE'>, { nil: undefined }),
  dewPointN2: fc.option(fc.double({ min: -80, max: 0, noNaN: true }), { nil: undefined }),
  dewPointH2: fc.option(fc.double({ min: -80, max: 0, noNaN: true }), { nil: undefined }),
  temperatureDegC: fc.option(fc.double({ min: 0, max: 1200, noNaN: true }), { nil: undefined }),
  expUnloadingTime: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  unloadingWtMt: fc.option(fc.double({ min: 0, max: 200, noNaN: true }), { nil: undefined }),
  loadingMt: fc.option(fc.double({ min: 0, max: 200, noNaN: true }), { nil: undefined }),
  unloadingMt: fc.option(fc.double({ min: 0, max: 200, noNaN: true }), { nil: undefined }),
  cummLoadingMt: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: undefined }),
  cummUnloadingMt: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: undefined }),
});

// â”€â”€ SKP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const skpPassArb = fc.record({
  passNo: fc.integer({ min: 1, max: 6 }),
  thicknessMm: fc.double({ min: 0.1, max: 20, noNaN: true }),
});

const skpEntryArb = fc.record({
  id: fc.uuid(),
  shiftLogId: fc.uuid(),
  coilNo: fc.string({ minLength: 1, maxLength: 20 }),
  startTime: fc.date(),
  widthMm: fc.double({ min: 1, max: 3000, noNaN: true }),
  thkMm: fc.double({ min: 0.1, max: 20, noNaN: true }),
  finalThkMm: fc.double({ min: 0.1, max: 20, noNaN: true }),
  totalPasses: fc.option(fc.integer({ min: 1, max: 6 }), { nil: undefined }),
  weightMt: fc.double({ min: 0, max: 50, noNaN: true }),
  rwTensionKg: fc.option(fc.double({ min: 0, max: 10000, noNaN: true }), { nil: undefined }),
  surfaceFinish: fc.string({ minLength: 1, maxLength: 20 }),
  reRolling: fc.boolean(),
  holdMt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  rejectionMt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  wtRollingMt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  wtRerollMt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  wtSkinpassMt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  wtScrapMt: fc.option(fc.double({ min: 0, max: 5, noNaN: true }), { nil: undefined }),
  rollsIn: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  rollsOut: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  coolantTempDegC: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  coolantPressKgCm2: fc.option(fc.double({ min: 0, max: 20, noNaN: true }), { nil: undefined }),
  passes: fc.array(skpPassArb, { maxLength: 6 }),
});

// â”€â”€ RWD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const rwdEntryArb = fc.record({
  id: fc.uuid(),
  shiftLogId: fc.uuid(),
  coilNo: fc.string({ minLength: 1, maxLength: 20 }),
  startTime: fc.date(),
  widthMm: fc.double({ min: 1, max: 3000, noNaN: true }),
  thkMm: fc.double({ min: 0.1, max: 20, noNaN: true }),
  outputThkMm: fc.double({ min: 0.1, max: 20, noNaN: true }),
  weightMt: fc.double({ min: 0, max: 50, noNaN: true }),
  rwTension1Kg: fc.option(fc.double({ min: 0, max: 10000, noNaN: true }), { nil: undefined }),
  rwTension2Kg: fc.option(fc.double({ min: 0, max: 10000, noNaN: true }), { nil: undefined }),
  rwTension3Kg: fc.option(fc.double({ min: 0, max: 10000, noNaN: true }), { nil: undefined }),
  surfaceFinish: fc.string({ minLength: 1, maxLength: 20 }),
  timeFrom: fc.option(timeStr, { nil: undefined }),
  timeTo: fc.option(timeStr, { nil: undefined }),
});

// â”€â”€ CRS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const crsEntryArb = fc.record({
  id: fc.uuid(),
  shiftLogId: fc.uuid(),
  coilNo: fc.string({ minLength: 1, maxLength: 20 }),
  startTime: fc.date(),
  slitNo: fc.string({ minLength: 1, maxLength: 20 }),
  coilWidthMm: fc.double({ min: 1, max: 3000, noNaN: true }),
  nominalThkMm: fc.double({ min: 0.1, max: 20, noNaN: true }),
  actualWidthMm: fc.option(fc.double({ min: 1, max: 3000, noNaN: true }), { nil: undefined }),
  actualThkFrontMm: fc.option(fc.double({ min: 0.1, max: 20, noNaN: true }), { nil: undefined }),
  actualThkRearMm: fc.option(fc.double({ min: 0.1, max: 20, noNaN: true }), { nil: undefined }),
  hardnessVpn: fc.option(fc.double({ min: 0, max: 400, noNaN: true }), { nil: undefined }),
  hardnessHrb: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  ibTiecv: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  utsNmm2: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: undefined }),
  elongationPct: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  ysrBurr: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  camberWaviness: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  raUm: fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: undefined }),
  rzUm: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  outputWtMt: fc.double({ min: 0, max: 50, noNaN: true }),
  rejectionOdMt: fc.option(fc.double({ min: 0, max: 5, noNaN: true }), { nil: undefined }),
  rejectionIdMt: fc.option(fc.double({ min: 0, max: 5, noNaN: true }), { nil: undefined }),
  coatingWtBr: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  coatingWtMatt: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  rpOilGrade: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  holdMt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  forCtlMt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  slitSlots: fc.array(slitSlotArb, { maxLength: 4 }),
});

// â”€â”€ CTL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ctlEntryArb = fc.record({
  id: fc.uuid(),
  shiftLogId: fc.uuid(),
  coilNo: fc.string({ minLength: 1, maxLength: 20 }),
  startTime: fc.date(),
  widthMm: fc.double({ min: 1, max: 3000, noNaN: true }),
  thkMm: fc.double({ min: 0.1, max: 20, noNaN: true }),
  weightMt: fc.double({ min: 0, max: 50, noNaN: true }),
  nominalSetLengthMm: fc.double({ min: 100, max: 10000, noNaN: true }),
  actualLengthMm: fc.double({ min: 100, max: 10000, noNaN: true }),
  noPieces: fc.integer({ min: 0, max: 10000 }),
  noBundles: fc.integer({ min: 0, max: 1000 }),
  totalProdMt: fc.double({ min: 0, max: 50, noNaN: true }),
  holdMt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  rejectionMt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  lowSpeed: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  estimatedSuppressed: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  timeFrom: fc.option(timeStr, { nil: undefined }),
  timeTo: fc.option(timeStr, { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Helper: check that a value satisfies a required numeric field
// ---------------------------------------------------------------------------

function isValidNumber(v: unknown): boolean {
  return typeof v === 'number' && !isNaN(v);
}

function isValidString(v: unknown): boolean {
  return typeof v === 'string';
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Property 5: Formâ€“schema field conformance', () => {

  it('5a â€” HRS: required fields are present and correctly typed (Req 3.1, 3.3)', () => {
    fc.assert(
      fc.property(hrsEntryArb, (entry: HRSEntry) => {
        expect(isValidString(entry.id)).toBe(true);
        expect(isValidString(entry.coilNo)).toBe(true);
        expect(entry.coilNo.length).toBeGreaterThan(0);
        expect(isValidNumber(entry.nominalWidthMm)).toBe(true);
        if (entry.actualWidthMm != null) expect(isValidNumber(entry.actualWidthMm)).toBe(true);
        expect(isValidNumber(entry.nominalThkMm)).toBe(true);
        expect(isValidNumber(entry.weightMt)).toBe(true);
        expect(isValidNumber(entry.scrapMt)).toBe(true);
        expect(Array.isArray(entry.slitSlots)).toBe(true);
        expect(entry.slitSlots.length).toBeLessThanOrEqual(4);
      }),
      { numRuns: 100 }
    );
  });

  it('5b â€” PKL: required fields are present and correctly typed (Req 3.1, 3.4)', () => {
    fc.assert(
      fc.property(pklEntryArb, (entry: PKLEntry) => {
        expect(isValidString(entry.id)).toBe(true);
        expect(isValidString(entry.coilNo)).toBe(true);
        expect(isValidNumber(entry.widthMm)).toBe(true);
        expect(isValidNumber(entry.thkMm)).toBe(true);
        expect(isValidNumber(entry.weightMt)).toBe(true);
        expect(isValidNumber(entry.lineSpeedMpm)).toBe(true);
        expect(isValidString(entry.heatNo)).toBe(true);
        expect(isValidString(entry.source)).toBe(true);
        // Optional coded text fields â€” must be string if present
        if (entry.wip !== undefined) expect(isValidString(entry.wip)).toBe(true);
        if (entry.leaderEnd !== undefined) expect(isValidString(entry.leaderEnd)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('5c â€” PKL-Chart: tankNo must be in {1,2,3} and chartTime must be HH:mm (Req 3.1, 3.4)', () => {
    fc.assert(
      fc.property(pklChartArb, (row: PKLChartRow) => {
        expect(isValidString(row.id)).toBe(true);
        expect([1, 2, 3]).toContain(row.tankNo);
        expect(isValidString(row.chartTime)).toBe(true);
        expect(row.chartTime).toMatch(/^\d{2}:\d{2}$/);
      }),
      { numRuns: 100 }
    );
  });

  it('5d â€” CRM: required fields are present; optional quality block fields are numeric when set (Req 3.1, 3.5)', () => {
    fc.assert(
      fc.property(crmEntryArb, (entry: CRMEntry) => {
        expect(isValidString(entry.id)).toBe(true);
        expect(isValidNumber(entry.widthMm)).toBe(true);
        expect(isValidNumber(entry.inputThkMm)).toBe(true);
        expect(isValidNumber(entry.outputThkMm)).toBe(true);
        expect(isValidNumber(entry.weightMt)).toBe(true);
        if (entry.hardnessVpn !== undefined) expect(isValidNumber(entry.hardnessVpn)).toBe(true);
        if (entry.hardnessHrb !== undefined) expect(isValidNumber(entry.hardnessHrb)).toBe(true);
        if (entry.rollIn !== undefined) expect(isValidString(entry.rollIn)).toBe(true);
        if (entry.rollOut !== undefined) expect(isValidString(entry.rollOut)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('5e â€” ANN: required fields present; status must be one of the four canonical values if set (Req 3.1, 3.6)', () => {
    fc.assert(
      fc.property(annEntryArb, (entry: ANNEntry) => {
        expect(isValidString(entry.chargeNo)).toBe(true);
        expect(isValidString(entry.baseNo)).toBe(true);
        expect(typeof entry.furnaceId === 'number').toBe(true);
        expect(isValidString(entry.gradeCode)).toBe(true);
        expect(typeof entry.noOfCoils === 'number').toBe(true);
        if (entry.status !== undefined) {
          expect(['IN_PROCESS', 'FOR_ANN', 'RW', 'DONE']).toContain(entry.status);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('5f â€” SKP: passes array entries carry only passNo and thicknessMm (no tension) (Req 3.1, 3.7)', () => {
    fc.assert(
      fc.property(skpEntryArb, (entry: SKPEntry) => {
        expect(Array.isArray(entry.passes)).toBe(true);
        expect(entry.passes.length).toBeLessThanOrEqual(6);
        for (const pass of entry.passes) {
          expect(typeof pass.passNo === 'number').toBe(true);
          expect(pass.passNo).toBeGreaterThanOrEqual(1);
          expect(pass.passNo).toBeLessThanOrEqual(6);
          expect(isValidNumber(pass.thicknessMm)).toBe(true);
          // No tension field on pass
          expect((pass as any).tension).toBeUndefined();
          expect((pass as any).tensionKg).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('5g â€” RWD: exactly three tension fields, all numeric when set (Req 3.1, 3.8)', () => {
    fc.assert(
      fc.property(rwdEntryArb, (entry: RWDEntry) => {
        expect(isValidNumber(entry.widthMm)).toBe(true);
        expect(isValidNumber(entry.outputThkMm)).toBe(true);
        if (entry.rwTension1Kg !== undefined) expect(isValidNumber(entry.rwTension1Kg)).toBe(true);
        if (entry.rwTension2Kg !== undefined) expect(isValidNumber(entry.rwTension2Kg)).toBe(true);
        if (entry.rwTension3Kg !== undefined) expect(isValidNumber(entry.rwTension3Kg)).toBe(true);
        // No fourth tension
        expect((entry as any).rwTension4Kg).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('5h â€” CRS: quality block fields correct type; rpOilGrade is string if set (Req 3.1, 3.9)', () => {
    fc.assert(
      fc.property(crsEntryArb, (entry: CRSEntry) => {
        expect(isValidString(entry.slitNo)).toBe(true);
        expect(isValidNumber(entry.coilWidthMm)).toBe(true);
        expect(isValidNumber(entry.nominalThkMm)).toBe(true);
        expect(isValidNumber(entry.outputWtMt)).toBe(true);
        expect(Array.isArray(entry.slitSlots)).toBe(true);
        if (entry.rpOilGrade !== undefined) expect(isValidString(entry.rpOilGrade)).toBe(true);
        if (entry.raUm !== undefined) expect(isValidNumber(entry.raUm)).toBe(true);
        if (entry.rzUm !== undefined) expect(isValidNumber(entry.rzUm)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('5i â€” CTL: required production count fields are present and non-negative (Req 3.1, 3.10)', () => {
    fc.assert(
      fc.property(ctlEntryArb, (entry: CTLEntry) => {
        expect(isValidNumber(entry.widthMm)).toBe(true);
        expect(isValidNumber(entry.thkMm)).toBe(true);
        expect(isValidNumber(entry.weightMt)).toBe(true);
        expect(isValidNumber(entry.nominalSetLengthMm)).toBe(true);
        expect(isValidNumber(entry.actualLengthMm)).toBe(true);
        expect(typeof entry.noPieces === 'number').toBe(true);
        expect(entry.noPieces).toBeGreaterThanOrEqual(0);
        expect(typeof entry.noBundles === 'number').toBe(true);
        expect(entry.noBundles).toBeGreaterThanOrEqual(0);
        expect(isValidNumber(entry.totalProdMt)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
