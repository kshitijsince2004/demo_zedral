export interface ShiftClosedEvent {
  shiftLogId: string;
  processId: number;
  totalProdMt: number;
  closedAt: string;
}

export interface ProductionCountedEvent {
  countId: string;
  shiftLogId?: string;
  assetId: string;
  quantity: number;
  uom: string;
  countedAt: string;
  lineageRef: string;
}

export interface DowntimeLoggedEvent {
  stoppageId: string;
  shiftLogId: string;
  stoppageCode: string;
  category: 'MECH' | 'ELECT' | 'UTILITY';
  fromTime: string;
  toTime: string;
  durationMin: number;
  prodDate: string;
  lineageRef: string;
}

export interface DefectLoggedEvent {
  defectId: string;
  processId: number;
  entryId: string;
  coilNo?: string;
  defectCode: string;
  quantityMt?: number;
}
