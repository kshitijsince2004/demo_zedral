/** Canonical plant process codes from master.process. */
export type ProcessCode =
  | 'HRS'
  | 'PKL'
  | 'CRM'
  | '6HI'
  | 'ANN'
  | 'SKP'
  | 'RWD'
  | 'CRS'
  | 'CTL'
  | 'GLV';

export const CANONICAL_PROCESS_CODES: readonly ProcessCode[] = [
  'HRS',
  'PKL',
  '6HI',
  'ANN',
  'SKP',
  'RWD',
  'CRS',
  'CTL',
  'GLV',
] as const;
