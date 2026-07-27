import type { SixHiOrderDetail, SixHiQueueCard } from '@m1/shared-validation';

/** Seed workspace first paint from a queue card — full detail loads in background. */
export function seedOrderDetailFromQueueCard(card: SixHiQueueCard): SixHiOrderDetail {
  return {
    orderId: card.orderId ?? '',
    batchNumber: card.batchNumber,
    motherCoil: card.motherCoil,
    slitId: card.slitId,
    customer: card.customer,
    grade: card.grade,
    widthMm: card.widthMm,
    inputThkMm: card.inputThkMm,
    targetThkMm: card.targetThkMm,
    finishThkMm: card.finishThkMm,
    machineCode: card.machineCode,
    machineAllocated: card.machineAllocated,
    rollingPassNo: card.rollingPassNo,
    ppcWeightMt: card.weightMt,
    ppcThkMm: card.targetThkMm,
    subProcess: card.subProcess,
    status: card.status,
    ppcDestination: card.destination,
    ppcRollFinish: card.rollFinish,
    ppcRerollFlag: card.rerollFlag,
    prodDurationMin: card.productionDurationMin,
    remarks: [],
    stoppages: [],
    rollChanges: [],
  };
}
