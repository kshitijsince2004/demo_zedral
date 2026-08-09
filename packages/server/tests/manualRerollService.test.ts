import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const findActiveMachineOrder = vi.fn();
const recordEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/db', () => ({
  db: {
    selectFrom: vi.fn(),
    insertInto: vi.fn(),
    updateTable: vi.fn(),
    deleteFrom: vi.fn(),
  },
}));

vi.mock('../src/services/SixHiService', () => ({
  SixHiService: {
    findActiveMachineOrder: (...args: unknown[]) => findActiveMachineOrder(...args),
  },
}));

vi.mock('../src/services/MachineStateEventService', () => ({
  MachineStateEventService: {
    recordEvent: (...args: unknown[]) => recordEvent(...args),
  },
}));

import { db } from '../src/db';
import {
  ACTIVE_REROLL_CONFLICT,
  buildClaimedBatchSet,
  computeDurationMin,
  decodeCombinedBatches,
  encodeCombinedBatches,
  ManualRerollService,
  stripCombinedTag,
} from '../src/services/ManualRerollService';

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  for (const m of [
    'selectAll', 'select', 'where', 'innerJoin', 'leftJoin', 'orderBy', 'limit',
    'values', 'set', 'returningAll',
  ]) {
    c[m] = vi.fn(self);
  }
  (c.execute as ReturnType<typeof vi.fn>) = vi.fn(async () => (Array.isArray(result) ? result : []));
  (c.executeTakeFirst as ReturnType<typeof vi.fn>) = vi.fn(async () => (
    Array.isArray(result) ? result[0] : result
  ) ?? undefined);
  (c.executeTakeFirstOrThrow as ReturnType<typeof vi.fn>) = vi.fn(async () => {
    const row = Array.isArray(result) ? result[0] : result;
    if (row == null) throw new Error('no result');
    return row;
  });
  return c;
}

const inserted = {
  session_id: '11',
  order_id: '99',
  batch_number: 'B-1',
  batch_numbers: ['B-1'],
  machine_code: '6HI',
  machine_type: '6HI',
  operator_id: 7,
  shift_code: 'A',
  reroll_quantity: '1.250',
  status: 'IN_PROGRESS',
  remarks: null,
  start_time: new Date('2026-08-05T10:00:00Z'),
  end_time: null,
  duration_min: null,
};

const prepared = {
  ...inserted,
  status: 'PREPARING',
};

describe('ManualRerollService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findActiveMachineOrder.mockResolvedValue(null);
    recordEvent.mockResolvedValue(undefined);
  });

  it('encodes combined batch tags in remarks (legacy helper)', () => {
    expect(encodeCombinedBatches(['A'])).toBeNull();
    expect(encodeCombinedBatches(['A', 'B'], 'note')).toBe('[[batches:A,B]]\nnote');
    expect(decodeCombinedBatches('A', '[[batches:A,B]]\nnote')).toEqual(['A', 'B']);
    expect(stripCombinedTag('[[batches:A,B]]\nnote')).toBe('note');
  });

  it('rounds duration to nearest minute', () => {
    expect(computeDurationMin(new Date('2026-08-05T10:00:00Z'), new Date('2026-08-05T10:07:20Z'))).toBe(7);
    expect(computeDurationMin(new Date('2026-08-05T10:00:00Z'), new Date('2026-08-05T10:07:40Z'))).toBe(8);
  });

  it('rejects prepare when the mill has an active production order', async () => {
    findActiveMachineOrder.mockResolvedValue({ batchNumber: 'LIVE-1', status: 'IN_PROGRESS', subProcess: 'ROLLING' });
    await expect(ManualRerollService.prepareSession({
      machine: '6HI',
      batchNumber: 'B-1',
      orderId: 99,
      rerollQuantity: 1.25,
      operatorId: 7,
      shiftCode: 'A',
    })).rejects.toThrow('ACTIVE_ORDER_CONFLICT:LIVE-1');
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it('rejects prepare when a re-roll session is already blocking', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain(inserted));
    await expect(ManualRerollService.prepareSession({
      machine: '6HI',
      batchNumber: 'B-2',
      rerollQuantity: 1,
      operatorId: 7,
    })).rejects.toThrow(ACTIVE_REROLL_CONFLICT);
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it('prepares a session without starting the mill timer', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain(null));
    (db.insertInto as ReturnType<typeof vi.fn>).mockReturnValue(chain(prepared));

    const session = await ManualRerollService.prepareSession({
      machine: '6HI',
      batchNumber: 'B-1',
      orderId: 99,
      rerollQuantity: 1.25,
      operatorId: 7,
      shiftCode: 'A',
    });

    expect(session.status).toBe('PREPARING');
    expect(session.rerollQuantity).toBe(1.25);
    expect(db.insertInto).toHaveBeenCalledWith('txn.manual_reroll_session');
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('starts a prepared session and publishes RUNNING_STARTED', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain(prepared));
    (db.updateTable as ReturnType<typeof vi.fn>).mockReturnValue(chain(inserted));

    const session = await ManualRerollService.startPreparedSession('11');
    expect(session.status).toBe('IN_PROGRESS');
    expect(recordEvent).toHaveBeenCalledWith(
      '6HI',
      'RUNNING_STARTED',
      expect.objectContaining({ batchNumber: 'B-1', meta: expect.objectContaining({ source: 'MANUAL_REROLL' }) }),
    );
  });

  it('rejects start when session is not preparing', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain(inserted));
    await expect(ManualRerollService.startPreparedSession('11')).rejects.toThrow('SESSION_NOT_PREPARING');
  });

  it('saves capture weight and passes', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain({
      ...inserted,
      actual_weight_mt: '2.5',
    }));
    (db.updateTable as ReturnType<typeof vi.fn>).mockReturnValue(chain(null));
    (db.deleteFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain(null));
    (db.insertInto as ReturnType<typeof vi.fn>).mockReturnValue(chain(null));

    const session = await ManualRerollService.updateCapture('11', {
      actualWeightMt: 2.5,
      actualWeightSource: 'manual',
      passes: [{ passNo: 1, thicknessMm: 1.2 }],
    });
    expect(session.actualWeightMt).toBe(2.5);
    expect(db.deleteFrom).toHaveBeenCalledWith('txn.manual_reroll_pass');
    expect(db.insertInto).toHaveBeenCalledWith('txn.manual_reroll_pass');
  });

  it('rejects end while still preparing', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain(prepared));
    await expect(ManualRerollService.endSession('11', 7)).rejects.toThrow('SESSION_STILL_PREPARING');
  });

  it('ends a session with computed duration', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain(inserted));
    const closed = {
      ...inserted,
      status: 'COMPLETED',
      end_time: new Date('2026-08-05T10:12:00Z'),
      duration_min: 12,
    };
    (db.updateTable as ReturnType<typeof vi.fn>).mockReturnValue(chain(closed));

    const session = await ManualRerollService.endSession('11', 7);
    expect(session.status).toBe('COMPLETED');
    expect(session.durationMin).toBe(12);
    expect(recordEvent).toHaveBeenCalledWith('6HI', 'RUNNING_ENDED', expect.any(Object));
    expect(recordEvent).toHaveBeenCalledWith('6HI', 'IDLE_STARTED', expect.any(Object));
  });

  it('holds a running session with remarks and rejects hold while stopped', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain(inserted));
    (db.updateTable as ReturnType<typeof vi.fn>).mockReturnValue(chain({
      ...inserted,
      status: 'ON_HOLD',
      remarks: 'coil jam',
    }));
    await expect(ManualRerollService.holdSession('11', '  ')).rejects.toThrow('HOLD_REMARKS_REQUIRED');

    const held = await ManualRerollService.holdSession('11', 'coil jam');
    expect(held.status).toBe('ON_HOLD');
    expect(held.remarks).toBe('coil jam');
    expect(recordEvent).toHaveBeenCalledWith('6HI', 'RUNNING_ENDED', expect.any(Object));
    expect(recordEvent).toHaveBeenCalledWith(
      '6HI',
      'IDLE_STARTED',
      expect.objectContaining({ reason: 'coil jam' }),
    );

    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain({
      ...inserted,
      status: 'STOPPAGE',
    }));
    await expect(ManualRerollService.holdSession('11', 'x')).rejects.toThrow('SESSION_NOT_RUNNING');
  });

  it('releases hold to pending by closing the session', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain({
      ...inserted,
      status: 'ON_HOLD',
      remarks: 'wait QC',
    }));
    (db.updateTable as ReturnType<typeof vi.fn>).mockReturnValue(chain({
      ...inserted,
      status: 'CANCELLED',
      remarks: 'wait QC',
      end_time: new Date('2026-08-05T10:05:00Z'),
      duration_min: 5,
    }));
    const released = await ManualRerollService.releaseToPending('11', 7);
    expect(released.status).toBe('CANCELLED');
  });

  it('resumes a held session', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain({
      ...inserted,
      status: 'ON_HOLD',
    }));
    (db.updateTable as ReturnType<typeof vi.fn>).mockReturnValue(chain(inserted));
    const resumed = await ManualRerollService.resumeSession('11');
    expect(resumed.status).toBe('IN_PROGRESS');
    expect(recordEvent).toHaveBeenCalledWith('6HI', 'RUNNING_STARTED', expect.any(Object));
  });

  it('cancels a session', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain(inserted));
    (db.updateTable as ReturnType<typeof vi.fn>).mockReturnValue(chain({
      ...inserted,
      status: 'CANCELLED',
      end_time: new Date('2026-08-05T10:05:00Z'),
      duration_min: 5,
    }));
    const session = await ManualRerollService.cancelSession('11', 7);
    expect(session.status).toBe('CANCELLED');
  });

  it('summarizes completed quantity', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain([
      { reroll_quantity: '1.5', shift_code: 'A', order_id: '1', batch_number: 'B-1' },
      { reroll_quantity: '0.5', shift_code: 'A', order_id: '1', batch_number: 'B-1' },
      { reroll_quantity: '2', shift_code: 'B', order_id: '2', batch_number: 'B-2' },
    ]));

    const summary = await ManualRerollService.getProductionSummary({
      machine: '6HI',
      from: new Date('2026-08-05T00:00:00Z'),
      to: new Date('2026-08-05T23:59:59Z'),
      fromLabel: '2026-08-05',
      toLabel: '2026-08-05',
    });

    expect(summary.totalRerollMt).toBe(4);
    expect(summary.sessionCount).toBe(3);
    expect(summary.byShift).toHaveLength(2);
    expect(summary.byOrder).toHaveLength(2);
  });

  it('claims COMPLETED and open session batches (not CANCELLED)', () => {
    const claimed = buildClaimedBatchSet([
      { batch_number: 'DONE-1', batch_numbers: ['DONE-1'] },
      { batch_number: 'COMB-1', batch_numbers: ['COMB-1', 'COMB-2'] },
      { batch_number: 'HOLD-1', batch_numbers: ['HOLD-1'] },
    ]);
    expect(claimed.has('DONE-1')).toBe(true);
    expect(claimed.has('COMB-1')).toBe(true);
    expect(claimed.has('COMB-2')).toBe(true);
    expect(claimed.has('HOLD-1')).toBe(true);
    expect(claimed.has('CANCELLED-1')).toBe(false);
  });

  it('listClaimedBatchNumbers expands combined batch_numbers from DB rows', async () => {
    (db.selectFrom as ReturnType<typeof vi.fn>).mockReturnValue(chain([
      { batch_number: 'A', batch_numbers: ['A', 'B'], remarks: null },
      { batch_number: 'C', batch_numbers: ['C'], remarks: null },
    ]));
    const claimed = await ManualRerollService.listClaimedBatchNumbers('6HI');
    expect([...claimed].sort()).toEqual(['A', 'B', 'C']);
  });

  it('does not mutate CRM production tables', () => {
    const src = readFileSync(resolve(__dirname, '../src/services/ManualRerollService.ts'), 'utf8');
    expect(src).not.toMatch(/txn\.crm_order/);
    expect(src).not.toMatch(/txn\.prod_/);
    expect(src).toMatch(/MachineStateEventService/);
    expect(src).toMatch(/findActiveMachineOrder/);
  });
});
