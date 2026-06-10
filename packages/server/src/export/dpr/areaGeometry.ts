/** DPR template row geometry — matches Kiro spec (46-row blocks, title row 2). */

import { titleRow } from '../../dpr/geometry/blockGeometry';

/** Area code → offset from day title row (col A label row). */
export const AREA_TITLE_OFFSET: Record<string, number> = {
  HRS: 4,
  PKLG: 5,
  '4HI_R': 6,
  '4HI_RR': 7,
  '4HI_SP': 8,
  '6HI_R': 9,
  '6HI_RR': 10,
  '6HI_SP': 11,
  '2HI_SP': 12,
  '2HI_RW': 13,
  RW_LINE: 14,
  HPH: 15,
  CRS_1: 16,
  CRS_2: 17,
  CRS_3: 18,
  CRS_4: 19,
  CRS_5: 20,
  CRS_6: 21,
  CTL_1: 22,
  CTL_2: 23,
  CTL_3: 24,
  CTL_4: 25,
  CTL_5: 26,
  PKG: 27,
  WIP: 28,
  OT: 29,
};

/** Machine codes (machine head assignment) → DPR area codes. */
export const MACHINE_TO_DPR_AREAS: Record<string, string[]> = {
  '4HI': ['4HI_R', '4HI_RR', '4HI_SP'],
  '6HI': ['6HI_R', '6HI_RR', '6HI_SP', '2HI_SP', '2HI_RW'],
  CRM: ['6HI_R', '6HI_RR', '6HI_SP', '2HI_SP', '2HI_RW'],
  '2HI': ['2HI_SP', '2HI_RW'],
  HRS: ['HRS'],
  PKL: ['PKLG'],
  ANN: ['HPH'],
  RWD: ['RW_LINE'],
  CRS: ['CRS_1', 'CRS_2', 'CRS_3', 'CRS_4', 'CRS_5', 'CRS_6'],
  CTL: ['CTL_1', 'CTL_2', 'CTL_3', 'CTL_4', 'CTL_5'],
};

export function areaRow(dayIndex: number, areaCode: string): number {
  const offset = AREA_TITLE_OFFSET[areaCode];
  if (offset == null) throw new Error(`Unknown DPR area: ${areaCode}`);
  return titleRow(dayIndex) + offset;
}

export function dprAreasForMachines(machineCodes: string[]): string[] {
  const areas = new Set<string>();
  for (const code of machineCodes) {
    const mapped = MACHINE_TO_DPR_AREAS[code.toUpperCase()];
    if (mapped) mapped.forEach((a) => areas.add(a));
  }
  return [...areas];
}
