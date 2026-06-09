/** Internal route step status — never expose raw route codes in UI */

export type JourneyStepStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'HOLD'
  | 'REJECTED';

export type JourneyStatus = 'ACTIVE' | 'COMPLETED' | 'HOLD' | 'REJECTED';

export interface ProcessRouteStepView {
  stepNo: number;
  label: string;
  status: JourneyStepStatus;
  processCode?: string;
  machineCode?: string;
  subProcess?: string;
  completedAt?: string;
  startedAt?: string;
  /** Rolling step flagged as re-roll (Count > 1 or pass > 1). */
  isReroll?: boolean;
  rollingPassNo?: number;
}

export interface OrderJourneyView {
  journeyId: string;
  coilNo: string;
  status: JourneyStatus;
  currentStepNo: number;
  steps: ProcessRouteStepView[];
}
