export enum ShiftLogState {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REOPENED = 'REOPENED'
}

export enum CoilStatus {
  PLANNED = 'PLANNED',
  IN_PROCESS = 'IN_PROCESS',
  HOLD = 'HOLD',
  REWORK = 'REWORK',
  DONE = 'DONE',
  SCRAPPED = 'SCRAPPED'
}

export enum StoppageCategory {
  OPN = 'OPN',
  ELECT = 'ELECT',
  MECH = 'MECH',
  UTILITY = 'UTILITY',
  POWER = 'POWER',
  PLANNED = 'PLANNED',
  OTHER = 'OTHER'
}

export enum CrewRole {
  OPERATOR = 'OPERATOR',
  ASST = 'ASST',
  HELPER = 'HELPER',
  CRANE = 'CRANE',
  MTL = 'MTL',
  SHIFT_INCHARGE = 'SHIFT_INCHARGE',
  SHIFT_MANAGER = 'SHIFT_MANAGER',
}

export { UserRole, ROLE_RANK, ROLE_LABELS, normalizeRoleName, normalizeRoles, pickPrimaryRole } from './roles';

export type ProcessLine = string;
