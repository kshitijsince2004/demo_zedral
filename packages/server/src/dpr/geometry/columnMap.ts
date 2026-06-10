export const COLUMN_MAP = {
  production: ['C', 'D', 'E'],
  stoppage: {
    electrical: ['Z', 'AA', 'AB'],
    mechanical: ['AD', 'AE', 'AF'],
    operational: ['AH', 'AI', 'AJ']
  },
  availability: ['AL', 'AM', 'AN'],
  prevMaint: 'AP',
  powerFailure: ['AR', 'AS', 'AT'],
  rmShortage: ['BB', 'BC', 'BD'],
  scrap: ['BI', 'BJ', 'BK', 'BL', 'BM', 'BN', 'BO', 'BP', 'BQ', 'BR', 'BS', 'BT'], // BI-BT
  dayNumber: 'BH',
  date: 'M'
};

export const NEVER_WRITE_COLS = new Set(['F', 'G', 'H', 'X']);
