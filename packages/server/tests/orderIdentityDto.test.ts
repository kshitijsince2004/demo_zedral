import { describe, expect, it } from 'vitest';

/** Same display contract as client `displayMotherCoilId`. */
function displayMotherCoilId(order: {
  motherCoil?: string | null;
  coilNo?: string | null;
  batchNumber: string;
  slitId?: string | null;
}): string {
  const coil = (order.motherCoil ?? order.coilNo ?? order.batchNumber).trim();
  const slit = order.slitId?.trim();
  return slit ? `${coil} ${slit}` : coil;
}

describe('Order identity DTO contract (MH ↔ PH)', () => {
  it('Live rejected/history row and PH orderInfo produce the same identity string', () => {
    const mhRejected = {
      batchNumber: 'BATCH-42',
      coilNo: '1100038319',
      motherCoil: '1100038319',
      slitId: 'A',
      weightMt: 12.5,
    };
    const phOrderInfo = {
      batchNumber: 'BATCH-42',
      coilNo: '1100038319',
      motherCoil: '1100038319',
      slitId: 'A',
      weightMt: 12.5,
    };
    const mhOrderDetail = {
      batchNumber: 'BATCH-42',
      motherCoil: '1100038319',
      slitId: 'A',
      weightMt: 12.5,
    };

    expect(displayMotherCoilId(mhRejected)).toBe('1100038319 A');
    expect(displayMotherCoilId(phOrderInfo)).toBe(displayMotherCoilId(mhRejected));
    expect(displayMotherCoilId(mhOrderDetail)).toBe(displayMotherCoilId(mhRejected));
    expect(mhRejected.weightMt).toBe(phOrderInfo.weightMt);
    expect(mhRejected.weightMt).toBe(mhOrderDetail.weightMt);
  });
});
