import { ShiftLogState, CoilStatus, StoppageCategory, CrewRole, ProcessLine } from './enums';

export interface ShiftLog {
  id: string;
  prodDate: string; // YYYY-MM-DD
  shiftCode: string;
  processId: ProcessLine;
  millType?: string; // 2HI, 4HI, 6HI
  state: ShiftLogState;
  targetMt?: number;
  totalProdMt: number;
  lineInchargeId?: string;
  shiftManagerId?: string;
  approverId?: string;
  prevShiftLogId?: string;
  submittedAt?: Date;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Coil {
  coilNo: string;
  status: CoilStatus;
  currentProcessId: ProcessLine;
  nextDest?: ProcessLine;
  thicknessIn?: number;
  thicknessOut?: number;
  weightMt?: number;
  parentCoilNo?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BaseProcessEntry {
  id: string;
  shiftLogId: string;
  coilNo: string;
  slNo?: number;
  timeFrom?: string; // HH:mm
  timeTo?: string; // HH:mm
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoppageEntry {
  id: string;
  shiftLogId: string;
  stoppageCode: string;
  category: StoppageCategory;
  timeFrom: string; // HH:mm
  timeTo?: string; // HH:mm
  durationMinutes?: number;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CrewEntry {
  id: string;
  shiftLogId: string;
  operatorId: string;
  roleCode: CrewRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface DefectEntry {
  id: string;
  processId: ProcessLine;
  entryId: string;
  coilNo?: string;
  defectCode: string;
  location?: string;
  quantityMt?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DomainEvent<T = any> {
  eventId: string;
  eventType: string;
  timestamp: Date;
  data: T;
  metadata: {
    coilNo?: string;
    processId?: ProcessLine;
    shiftLogId?: string;
    gradeCode?: string;
    customerId?: string;
  };
}

export interface QueuedEntry {
  id: string;
  entityType: 'ProcessEntry' | 'StoppageEntry' | 'CrewEntry' | 'DefectEntry' | 'ShiftLog';
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: any;
  createdAt: Date;
  retryCount: number;
}
