/** Declarative DPR layout config (versioned JSON). */

export interface DprLayoutArea {
  areaCode: string;
  rowOffset: number;
}

export interface DprLayoutColumns {
  areaLabel: number;
  targetMt: number;
  prodA: number;
  prodB: number;
  prodC: number;
  prodTotal: number;
  cumMt: number;
  avgMt: number;
  stoppageElectA: number;
  stoppageElectB: number;
  stoppageElectC: number;
  stoppageMechA: number;
  stoppageMechB: number;
  stoppageMechC: number;
  stoppageOperA: number;
  stoppageOperB: number;
  stoppageOperC: number;
  utilisationToday: number;
  utilisationCum: number;
  prodRateA: number;
  prodRateB: number;
  prodRateC: number;
  prodRateToday: number;
  prodRateCum: number;
  prodRateTarget: number;
  /** Stoppage breakdown region (col Z = 26). */
  stoppageRegionStart: number;
  stoppageElectTotal: number;
  stoppageMechTotal: number;
  stoppageOperTotal: number;
  stoppageEquipA: number;
  stoppageEquipB: number;
  stoppageEquipC: number;
  stoppagePrevMaint: number;
  stoppagePower: number;
  stoppageNoPlan: number;
  stoppageRmShortage: number;
  equipAvailA: number;
  equipAvailB: number;
  equipAvailC: number;
  equipAvailCum: number;
  /** Scrap region (col 60+). */
  scrapRegionStart: number;
  scrapA: number;
  scrapB: number;
  scrapC: number;
  scrapTotal: number;
  scrapCum: number;
  scrapPct: number;
  rejA: number;
  rejB: number;
  rejC: number;
  rejTotal: number;
  rejCum: number;
  rejPct: number;
  bSlitTotal: number;
  trimTotal: number;
}

export interface DprLayoutRollupRows {
  despatchMt: number;
  yieldPct: number;
  wr4hiNos: number;
  wr4hiMin: number;
  wr6hiNos: number;
  wr6hiMin: number;
  wr2hiNos: number;
  wr2hiMin: number;
  fgBalanceMt: number;
}

export interface DprLayoutV1 {
  version: 1;
  blockHeight: number;
  emitFormulas: boolean;
  monthSheetNamePattern: string;
  blockStartRow: number;
  dateRowOffset: number;
  dateCol: number;
  areas: DprLayoutArea[];
  columns: DprLayoutColumns;
  rollupRows: DprLayoutRollupRows;
  delaySheet: {
    name: string;
    headerRow: number;
    dataStartRow: number;
    cols: {
      line: number;
      date: number;
      shift: number;
      minutes: number;
      agency: number;
      reason: number;
    };
  };
}

export interface RenderCell {
  row: number;
  col: number;
  value: string | number | null;
}

export interface BoundWorkbook {
  monthSheetName: string;
  monthCells: RenderCell[];
  delaySheetName: string;
  delayCells: RenderCell[];
  delayRows: Record<string, unknown>[];
}
