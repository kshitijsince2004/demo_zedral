export interface CanonicalProductionCount {
  countId: string;
  tenantId: string;
  assetId: string;
  quantity: number;
  uom: string;
  countedAt: string;
  lineageRef: string;
  shiftLogId?: string;
  isScrap: boolean;
}

export interface CanonicalEvent {
  eventId: string;
  tenantId: string;
  eventType: string;
  assetId?: string;
  category?: string;
  startedAt: string;
  endedAt?: string;
  durationMin?: number;
  lineageRef: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface CanonicalEquipmentNode {
  assetId: string;
  tenantId: string;
  assetCode: string;
  name: string;
}
