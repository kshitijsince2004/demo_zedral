import { describe, it, expect, vi } from 'vitest';
import { PROD_CARRY_PROCESS_IDS, reparentOpenWork } from '../src/services/handover/carryForward';

type WhereCall = { column: string; op: string; value: unknown };

function createMockTrx() {
  const updates: Array<{ table: string; set: Record<string, unknown>; wheres: WhereCall[] }> = [];

  const chain = (table: string) => {
    let setValues: Record<string, unknown> = {};
    const wheres: WhereCall[] = [];

    const builder = {
      set(values: Record<string, unknown>) {
        setValues = values;
        return builder;
      },
      where(column: string, op: string, value: unknown) {
        wheres.push({ column, op, value });
        return builder;
      },
      async execute() {
        updates.push({ table, set: setValues, wheres: [...wheres] });
      },
    };
    return builder;
  };

  const trx = {
    updateTable: vi.fn((table: string) => chain(table)),
    selectFrom: vi.fn(() => ({
      select: vi.fn(() => ({
        where: vi.fn(() => ({
          execute: vi.fn(async () => []),
        })),
      })),
    })),
  };

  return { trx: trx as never, updates };
}

describe('carryForward table map', () => {
  it('maps pilot process lines to real txn tables (no _entry suffix)', () => {
    expect(PROD_CARRY_PROCESS_IDS[1]).toBe('txn.prod_hrs');
    expect(PROD_CARRY_PROCESS_IDS[2]).toBe('txn.prod_pkl');
    expect(PROD_CARRY_PROCESS_IDS[4]).toBe('txn.ann_charge');
    expect(PROD_CARRY_PROCESS_IDS[6]).toBe('txn.prod_rwd');
    expect(PROD_CARRY_PROCESS_IDS[7]).toBe('txn.prod_crs');
    expect(PROD_CARRY_PROCESS_IDS[8]).toBe('txn.prod_ctl');
    expect(Object.values(PROD_CARRY_PROCESS_IDS).some((t) => t.includes('_entry'))).toBe(false);
  });

  it('includes HRS (process 1)', () => {
    expect(PROD_CARRY_PROCESS_IDS[1]).toBe('txn.prod_hrs');
  });
});

describe('reparentOpenWork', () => {
  it('reparents HRS IN_PROGRESS rows on txn.prod_hrs', async () => {
    const { trx, updates } = createMockTrx();

    await reparentOpenWork(trx, {
      machineCode: 'HRS1',
      processId: 1,
      outgoingShiftLogId: '10',
      incomingShiftLogId: '11',
      incomingShiftCode: 'B',
      incomingProdDate: '2026-06-08',
    });

    const hrs = updates.find((u) => u.table === 'txn.prod_hrs');
    expect(hrs).toBeDefined();
    expect(hrs?.set.shift_log_id).toBe('11');
    expect(hrs?.wheres).toEqual(
      expect.arrayContaining([
        { column: 'shift_log_id', op: '=', value: '10' },
        { column: 'status', op: '=', value: 'IN_PROGRESS' },
      ]),
    );
  });

  it('reparents PKL rows on txn.prod_pkl', async () => {
    const { trx, updates } = createMockTrx();

    await reparentOpenWork(trx, {
      machineCode: 'PKL1',
      processId: 2,
      outgoingShiftLogId: '20',
      incomingShiftLogId: '21',
      incomingShiftCode: 'C',
      incomingProdDate: '2026-06-08',
    });

    expect(updates.some((u) => u.table === 'txn.prod_pkl')).toBe(true);
  });

  it('reparents ANN rows with IN_PROCESS status on txn.ann_charge', async () => {
    const { trx, updates } = createMockTrx();

    await reparentOpenWork(trx, {
      machineCode: 'ANN1',
      processId: 4,
      outgoingShiftLogId: '30',
      incomingShiftLogId: '31',
      incomingShiftCode: 'A',
      incomingProdDate: '2026-06-09',
    });

    const ann = updates.find((u) => u.table === 'txn.ann_charge');
    expect(ann?.wheres).toEqual(
      expect.arrayContaining([{ column: 'status', op: '=', value: 'IN_PROCESS' }]),
    );
  });

  it('reparents SKP via txn.crm_order SKINPASS branch', async () => {
    const { trx, updates } = createMockTrx();

    await reparentOpenWork(trx, {
      machineCode: 'SKP1',
      processId: 5,
      outgoingShiftLogId: '40',
      incomingShiftLogId: '41',
      incomingShiftCode: 'B',
      incomingProdDate: '2026-06-08',
    });

    const skp = updates.find((u) => u.table === 'txn.crm_order');
    expect(skp?.wheres).toEqual(
      expect.arrayContaining([{ column: 'sub_process', op: '=', value: 'SKINPASS' }]),
    );
  });

  it('always reparents open stoppages', async () => {
    const { trx, updates } = createMockTrx();

    await reparentOpenWork(trx, {
      machineCode: 'CTL1',
      processId: 8,
      outgoingShiftLogId: '50',
      incomingShiftLogId: '51',
      incomingShiftCode: 'C',
      incomingProdDate: '2026-06-08',
    });

    expect(updates.some((u) => u.table === 'txn.stoppage')).toBe(true);
  });
});
