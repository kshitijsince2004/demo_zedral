export interface CellRef {
  row: number;
  col: string;
}

export enum FieldProvenance {
  AutoSourced = 'auto-sourced',
  NeedsConfirmation = 'needs-confirmation',
  Manual = 'manual',
  Confirmed = 'confirmed'
}

export enum DprField {
  ProductionC = 'ProductionC',
  ProductionD = 'ProductionD',
  ProductionE = 'ProductionE',
  StoppageElectrical1 = 'StoppageElectrical1',
  StoppageElectrical2 = 'StoppageElectrical2',
  StoppageElectrical3 = 'StoppageElectrical3',
  StoppageMechanical1 = 'StoppageMechanical1',
  StoppageMechanical2 = 'StoppageMechanical2',
  StoppageMechanical3 = 'StoppageMechanical3',
  StoppageOperational1 = 'StoppageOperational1',
  StoppageOperational2 = 'StoppageOperational2',
  StoppageOperational3 = 'StoppageOperational3',
  Availability1 = 'Availability1',
  Availability2 = 'Availability2',
  Availability3 = 'Availability3',
  PrevMaint = 'PrevMaint',
  PowerFailure1 = 'PowerFailure1',
  PowerFailure2 = 'PowerFailure2',
  PowerFailure3 = 'PowerFailure3',
  RmShortage1 = 'RmShortage1',
  RmShortage2 = 'RmShortage2',
  RmShortage3 = 'RmShortage3',
  Scrap = 'Scrap'
}

export interface DayValues {
  dayNumber: number;
  machineId: string;
  values: Record<string, number | null>;
  provenance: Record<string, FieldProvenance>;
}

export interface DelayRow {
  shift: 'A' | 'B' | 'C' | 'G';
  machineId: string;
  time: string;
  agency: string;
  reason: string;
}
