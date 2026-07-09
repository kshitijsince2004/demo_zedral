/** 6HI production order statuses */

export type SixHiOrderStatus = 'PENDING' | 'PREPARING' | 'IN_PROGRESS' | 'STOPPAGE' | 'COMPLETED' | 'REJECTED';

export interface OrderRejectionInfo {
  reason: string;
  rejectedAt: string;
  rejectedBy?: string;
  remarks?: string;
  defectCodes?: string[];
}



export type SixHiSubProcess = 'ROLLING' | 'SKIN_PASS';



export type SixHiDestination = 'REWINDING' | 'ANNEALING';



export type SixHiRollFinish = 'MATT' | 'BRIGHT' | 'LOW_MATT';



export type SixHiOperatingMode = 'LOAD' | 'STRETCH';

export interface MasterDefectCode {
  defectCode: string;
  defectName: string;
  category: string | null;
  isActive: boolean;
}

export interface MasterStoppageCategory {
  categoryCode: string;
  label: string;
  requiresBreakdownCode: boolean;
  isActive: boolean;
}

export interface MasterStoppageCode {
  stoppageCode: string;
  description: string;
  category: string;
  isActive: boolean;
}



export interface SixHiRollingPass {

  passNo: number;

  thicknessMm: number;

}



export interface SixHiQueueCard {

  batchNumber: string;

  motherCoil: string;

  slitId?: string;

  customer: string;

  grade: string;

  widthMm: number;

  inputThkMm: number;

  targetThkMm: number;

  finishThkMm?: number;

  machineCode?: string;

  machineAllocated?: boolean;

  suggestedMachineCode?: string;

  rollingPassNo?: number;

  weightMt: number;

  destination?: SixHiDestination;

  rollFinish?: SixHiRollFinish;

  rerollFlag?: boolean;

  status: SixHiOrderStatus;

  subProcess: SixHiSubProcess;

  queuePosition: number;

  orderId?: string;

  activeStoppageCategory?: string;

  productionDurationMin?: number;

  /** PENDING order with saved production draft (operator prepared before start). */
  prepReady?: boolean;

  planDate?: string;

  shiftCode?: string;

  /** Incomplete order from a plan date before the operator's selected view date. */
  isBacklog?: boolean;

}



export interface SixHiOrderRemark {

  id: string;

  text: string;

  createdAt: string;

  operatorName?: string;

  defects?: {
    defectCode: string;
    quantityAffected?: number;
    remarks?: string;
  }[];

}



export interface SixHiRollChange {

  id: string;

  rollPosition: 'IN' | 'OUT';

  prevRollNo?: string;

  prevRollCode?: string;

  newRollNo: string;

  newRollCode?: string;

  reasonText?: string;

  changedAt: string;

  operatorName?: string;

}



export interface SixHiOrderStoppage {

  id: string;

  categoryCode: string;

  categoryLabel: string;

  breakdownCode?: string;

  startAt: string;

  endAt?: string;

  durationMin?: number;

  remarks?: string;

}



export interface SixHiRollingData {

  actualWeightMt?: number;

  destination: SixHiDestination;

  destinationOverride: boolean;

  associateRw?: string;

  etr?: number;

  dtr?: number;

  passes: SixHiRollingPass[];

  totalPasses: number;

  finalThkMm?: number;

  rollInNo?: string;

  rollInCode?: string;

  rollOutNo?: string;

  rollOutCode?: string;

}



export interface SixHiSkinPassData {

  actualWeightMt?: number;

  outputThkMm?: number;

  annHard?: number;

  rwTension1?: number;

  rwTension2?: number;

  operatingMode?: SixHiOperatingMode;

  loadMinT?: number;

  loadMaxT?: number;

  stretchPct?: number;

}



export interface SixHiOrderDetail {

  orderId: string;

  batchNumber: string;

  motherCoil: string;

  slitId?: string;

  customer: string;

  grade: string;

  widthMm: number;

  inputThkMm: number;

  targetThkMm: number;

  finishThkMm?: number;

  machineCode?: string;

  machineAllocated?: boolean;

  rollingPassNo?: number;

  rollingPassPlans?: {
    passNo: number;
    targetThkMm?: number;
    rollFinish?: SixHiRollFinish;
  }[];

  ppcWeightMt: number;

  /** @deprecated use targetThkMm */

  ppcThkMm: number;

  subProcess: SixHiSubProcess;

  status: SixHiOrderStatus;

  /** PPC-planned values (read-only context) */

  ppcDestination?: SixHiDestination;

  ppcRollFinish?: SixHiRollFinish;

  ppcRerollFlag?: boolean;

  prodStartAt?: string;

  prodEndAt?: string;

  prodDurationMin?: number;

  rolling?: SixHiRollingData;

  skinPass?: SixHiSkinPassData;

  remarks: SixHiOrderRemark[];

  stoppages: SixHiOrderStoppage[];

  rollChanges: SixHiRollChange[];

  activeStoppage?: SixHiOrderStoppage;

  rejection?: OrderRejectionInfo;

}



export interface SixHiShiftSummaryOrder {

  batchNumber: string;

  subProcess: SixHiSubProcess;

  customer: string;

  weightMt: number;

  durationMin?: number;

}



export interface SixHiShiftSummaryOrderInProgress {

  batchNumber: string;

  status: string;

  subProcess: string;

  machineCode: string;

}

export interface SixHiShiftSummary {

  shiftLogId: string;

  totalProdMt: number;

  /** Weight from completed orders only. */
  completedProdMt?: number;

  /** Saved weight on in-progress / stoppage orders (not yet completed). */
  inProgressProdMt?: number;

  totalRollingMt: number;

  totalRerollMt: number;

  totalSkinpassMt: number;

  scrapKg?: number;

  coolantTempDegC?: number;

  coolantPressKgCm2?: number;

  completedOrders?: SixHiShiftSummaryOrder[];

  totalStoppageMinutes?: number;

  totalBreakdownMinutes?: number;

  machineUtilizationPct?: number;

  ordersInProgress?: SixHiShiftSummaryOrderInProgress[];

}



export interface SixHiStoppageCategory {

  categoryCode: string;

  label: string;

  requiresBreakdownCode: boolean;

}



export interface PPCImportRow {

  batch_number: string;

  plan_date: string;

  shift_code: string;

  machine_code: string;

  sub_process: string;

  coil_no: string;

  slit_id?: string;

  customer_name: string;

  grade_code: string;

  width_mm: number;

  input_thk_mm?: number;

  ppc_thk_mm: number;

  ppc_weight_mt: number;

  destination?: string;

  roll_finish?: string;

  ppc_reroll_flag?: boolean;

  queue_seq?: number;

  sap_order_no?: string;

  /** Internal route codes e.g. S-P-6-F-Z-C-LE — never shown in UI */
  process_route?: string;

}

