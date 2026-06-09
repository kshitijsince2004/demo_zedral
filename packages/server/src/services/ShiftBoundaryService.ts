import { db } from '../db';
import { ShiftDetectionService, resolveShiftFromClock } from './ShiftDetectionService';
import { ShiftAttributionService } from './ShiftAttributionService';
import { SixHiService } from './SixHiService';
import { MachineHandoverService } from './MachineHandoverService';

const SYSTEM_USER_ID = Number(process.env.EXPORT_SYSTEM_USER_ID ?? 1);

export interface BoundaryShiftContext {
  outgoingShiftCode: string;
  outgoingProdDate: string;
  incomingShiftCode: string;
  incomingProdDate: string;
}

function previousShift(shiftCode: string, prodDate: string): { shiftCode: string; prodDate: string } {
  if (shiftCode === 'A') {
    const d = new Date(prodDate);
    d.setDate(d.getDate() - 1);
    return { shiftCode: 'C', prodDate: d.toISOString().slice(0, 10) };
  }
  if (shiftCode === 'B') return { shiftCode: 'A', prodDate };
  if (shiftCode === 'C') return { shiftCode: 'B', prodDate };
  return { shiftCode, prodDate };
}

export function resolveBoundaryShifts(
  windows: { shift_code: string; name: string; start_time: string; end_time: string }[],
  at: Date,
): BoundaryShiftContext {
  const incoming = resolveShiftFromClock(windows, at);
  const outgoing = previousShift(incoming.shiftCode, incoming.prodDate);

  return {
    outgoingShiftCode: outgoing.shiftCode,
    outgoingProdDate: outgoing.prodDate,
    incomingShiftCode: incoming.shiftCode,
    incomingProdDate: incoming.prodDate,
  };
}

export class ShiftBoundaryService {
  static async listCrmMachineCodes(): Promise<string[]> {
    const rows = await db
      .selectFrom('master.machine')
      .select('machine_code')
      .where('process_code', '=', 'CRM')
      .orderBy('machine_code', 'asc')
      .execute();
    return rows.map((r) => r.machine_code);
  }

  static async processAllMachines(at = new Date()): Promise<{ processed: number; handovers: number }> {
    const windows = await ShiftDetectionService.listShiftWindows();
    const boundary = resolveBoundaryShifts(windows, at);
    const machines = await this.listCrmMachineCodes();

    let handovers = 0;
    for (const machineCode of machines) {
      const result = await this.processMachine(machineCode, boundary);
      if (result === 'HANDOVER') handovers += 1;
    }

    await db
      .insertInto('txn.shift_event_audit')
      .values({
        event_type: 'SHIFT_BOUNDARY',
        entity_type: 'boundary',
        entity_id: `${boundary.outgoingShiftCode}:${boundary.outgoingProdDate}`,
        payload: {
          ...boundary,
          machineCount: machines.length,
          handoverCount: handovers,
        },
        user_id: SYSTEM_USER_ID,
      })
      .execute();

    return { processed: machines.length, handovers };
  }

  static async processMachine(
    machineCode: string,
    boundary: BoundaryShiftContext,
  ): Promise<'IDLE' | 'HANDOVER' | 'SKIPPED'> {
    const existing = await MachineHandoverService.getPendingForMachine(machineCode);
    if (existing) return 'SKIPPED';

    const active = await SixHiService.findActiveMachineOrder(machineCode);

    await ShiftAttributionService.attributeMachineOrder(
      machineCode,
      boundary.outgoingShiftCode,
      boundary.outgoingProdDate,
    );

    if (active) {
      await MachineHandoverService.createBoundaryHandover(
        machineCode,
        boundary,
        SYSTEM_USER_ID,
      );
      return 'HANDOVER';
    }

    await db
      .updateTable('txn.machine_shift_session')
      .set({ status: 'CLOSED', closed_at: new Date() })
      .where('machine_code', '=', machineCode)
      .where('status', '=', 'ACTIVE')
      .execute();

    const shiftLogId = await ShiftAttributionService.resolveShiftLogId(
      boundary.outgoingShiftCode,
      boundary.outgoingProdDate,
    );
    if (shiftLogId) {
      await SixHiService.saveShiftSummary(shiftLogId, undefined, undefined, undefined, SYSTEM_USER_ID);
    }

    await db
      .insertInto('txn.shift_event_audit')
      .values({
        event_type: 'SHIFT_BOUNDARY_IDLE',
        entity_type: 'machine',
        entity_id: machineCode,
        machine_code: machineCode,
        user_id: SYSTEM_USER_ID,
        payload: {
          outgoingShift: boundary.outgoingShiftCode,
          outgoingProdDate: boundary.outgoingProdDate,
        },
      })
      .execute();

    return 'IDLE';
  }
}
