/** DPR line-area resolution helpers. */

import { formatPlantDate } from '@m1/shared-validation';

const CRM6_AREA_BY_KEY: Record<string, string> = {
  '4HI:ROLLING:false': '4HI_R',
  '4HI:ROLLING:true': '4HI_RR',
  '4HI:SKIN_PASS:false': '4HI_SP',
  '4HI:SKIN_PASS:true': '4HI_SP',
  '6HI:ROLLING:false': '6HI_R',
  '6HI:ROLLING:true': '6HI_RR',
  '6HI:SKIN_PASS:false': '6HI_SP',
  '6HI:SKIN_PASS:true': '6HI_SP',
  '2HI:ROLLING:false': '2HI_RW',
  '2HI:ROLLING:true': '2HI_RW',
  '2HI:SKIN_PASS:false': '2HI_SP',
  '2HI:SKIN_PASS:true': '2HI_SP',
};

const PROCESS_DEFAULT_AREA: Record<string, string> = {
  HRS: 'HRS',
  PKL: 'PKLG',
  ANN: 'HPH',
  SKP: '6HI_SP',
  RWD: 'RW_LINE',
  CRS: 'CRS_1',
  CTL: 'CTL_1',
};

export function resolveCrm6AreaCode(
  machineCode: string,
  subProcess: string,
  rerolling = false,
): string {
  const key = `${machineCode.toUpperCase()}:${subProcess.toUpperCase()}:${rerolling}`;
  return CRM6_AREA_BY_KEY[key] ?? '6HI_R';
}

export function resolveMillLineArea(
  processCode: 'CRS' | 'CTL',
  millType: string | null | undefined,
): string {
  const prefix = processCode === 'CRS' ? 'CRS_' : 'CTL_';
  const maxLine = processCode === 'CRS' ? 6 : 5;
  if (!millType) return `${prefix}1`;
  const match = millType.match(/(\d+)/);
  const lineNo = match
    ? Math.min(Math.max(parseInt(match[1], 10), 1), maxLine)
    : 1;
  return `${prefix}${lineNo}`;
}

export function resolveProcessArea(
  processCode: string,
  millType?: string | null,
): string {
  if (processCode === 'CRS' || processCode === 'CTL') {
    return resolveMillLineArea(processCode, millType);
  }
  return PROCESS_DEFAULT_AREA[processCode] ?? processCode;
}

export function toDateString(value: Date | string): string {
  // Use plant-local calendar parts (the app-wide date-only convention). A Postgres
  // `date` column is returned by pg as a JS Date at LOCAL midnight; formatting it via
  // toISOString() (UTC) shifts it a day earlier in positive-offset zones (e.g. IST),
  // which would misattribute DPR production/stoppages to the wrong calendar day.
  return formatPlantDate(value);
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
