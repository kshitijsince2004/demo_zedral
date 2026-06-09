/** DPR area registry (mirrors master.line_area seed). */

export interface LineAreaDef {
  areaCode: string;
  areaLabel: string;
  processCode: string | null;
  operatingMinutesBase: number;
  isDprReported: boolean;
  sortOrder: number;
}

export const DPR_LINE_AREAS: LineAreaDef[] = [
  { areaCode: 'HRS', areaLabel: 'HRS', processCode: 'HRS', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 1 },
  { areaCode: 'PKLG', areaLabel: 'PKLG', processCode: 'PKL', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 2 },
  { areaCode: '4HI_R', areaLabel: '4 Hi(R)', processCode: '6HI', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 3 },
  { areaCode: '4HI_RR', areaLabel: '4 Hi(RR)', processCode: '6HI', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 4 },
  { areaCode: '4HI_SP', areaLabel: '4 Hi(SP)', processCode: '6HI', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 5 },
  { areaCode: '6HI_R', areaLabel: '6 Hi(R)', processCode: '6HI', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 6 },
  { areaCode: '6HI_RR', areaLabel: '6 Hi(RR)', processCode: '6HI', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 7 },
  { areaCode: '6HI_SP', areaLabel: '6HI SP', processCode: '6HI', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 8 },
  { areaCode: '2HI_SP', areaLabel: '2 Hi(SP)', processCode: '6HI', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 9 },
  { areaCode: '2HI_RW', areaLabel: '2HIR/W', processCode: '6HI', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 10 },
  { areaCode: 'RW_LINE', areaLabel: 'R/W LINE', processCode: 'RWD', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 11 },
  { areaCode: 'HPH', areaLabel: 'HPH', processCode: 'ANN', operatingMinutesBase: 23040, isDprReported: true, sortOrder: 12 },
  { areaCode: 'CRS_1', areaLabel: 'CRS-1', processCode: 'CRS', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 13 },
  { areaCode: 'CRS_2', areaLabel: 'CRS-2', processCode: 'CRS', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 14 },
  { areaCode: 'CRS_3', areaLabel: 'CRS-3', processCode: 'CRS', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 15 },
  { areaCode: 'CRS_4', areaLabel: 'CRS-4', processCode: 'CRS', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 16 },
  { areaCode: 'CRS_5', areaLabel: 'CRS-5', processCode: 'CRS', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 17 },
  { areaCode: 'CRS_6', areaLabel: 'CRS-6', processCode: 'CRS', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 18 },
  { areaCode: 'CTL_1', areaLabel: 'CTL-1', processCode: 'CTL', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 19 },
  { areaCode: 'CTL_2', areaLabel: 'CTL-2', processCode: 'CTL', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 20 },
  { areaCode: 'CTL_3', areaLabel: 'CTL-3', processCode: 'CTL', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 21 },
  { areaCode: 'CTL_4', areaLabel: 'CTL-4', processCode: 'CTL', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 22 },
  { areaCode: 'CTL_5', areaLabel: 'CTL-5', processCode: 'CTL', operatingMinutesBase: 1440, isDprReported: true, sortOrder: 23 },
  { areaCode: 'PKG', areaLabel: 'PKG', processCode: null, operatingMinutesBase: 1440, isDprReported: true, sortOrder: 24 },
  { areaCode: 'WIP', areaLabel: 'WIP', processCode: null, operatingMinutesBase: 1440, isDprReported: false, sortOrder: 25 },
  { areaCode: 'OT', areaLabel: 'O.T', processCode: null, operatingMinutesBase: 1440, isDprReported: false, sortOrder: 26 },
];

export const HPH_OPERATING_BASE = 16 * 24 * 60;

export function areaLabelFor(areaCode: string): string {
  return DPR_LINE_AREAS.find((a) => a.areaCode === areaCode)?.areaLabel ?? areaCode;
}
