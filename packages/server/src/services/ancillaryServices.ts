import { db } from '../db';
import { calculateStoppageDuration } from '@m1/shared-validation';

function parseTimeToDate(time: string): Date {
  return new Date(`1970-01-01T${time}`);
}

export class StoppageService {
  static async create(payload: any, _userId: string) {
    const fromTime = payload.fromTime ?? payload.startTime;
    const toTime = payload.toTime ?? payload.endTime ?? fromTime;

    if (!payload.shiftLogId) throw new Error('shiftLogId is required');
    if (!payload.stoppageCode) throw new Error('stoppageCode is required');
    if (!fromTime) throw new Error('fromTime is required');

    const durationMin =
      payload.durationMins ??
      (toTime
        ? calculateStoppageDuration(parseTimeToDate(fromTime), parseTimeToDate(toTime))
        : null);

    const row = await db
      .insertInto('txn.stoppage_entry')
      .values({
        shift_log_id: payload.shiftLogId,
        stoppage_code: payload.stoppageCode,
        time_from: fromTime,
        time_to: toTime,
        duration_min: durationMin,
        remarks: payload.remarks ?? null,
      })
      .returning('stoppage_id')
      .executeTakeFirstOrThrow();

    return String(row.stoppage_id);
  }
}

export class CrewService {
  static async resolveOperatorId(operatorId: string | number): Promise<number> {
    const asNum = Number(operatorId);
    if (!Number.isNaN(asNum) && asNum > 0) {
      const byId = await db
        .selectFrom('master.operator')
        .select('operator_id')
        .where('operator_id', '=', asNum)
        .executeTakeFirst();
      if (byId) return Number(byId.operator_id);
    }

    const byCode = await db
      .selectFrom('master.operator')
      .select('operator_id')
      .where('emp_code', '=', String(operatorId))
      .executeTakeFirst();

    if (!byCode) throw new Error(`Operator not found: ${operatorId}`);
    return Number(byCode.operator_id);
  }

  static async listByShiftLog(shiftLogId: string) {
    const rows = await db
      .selectFrom('txn.crew_entry as c')
      .innerJoin('master.operator as o', 'o.operator_id', 'c.operator_id')
      .select(['c.crew_id', 'c.operator_id', 'c.role_code', 'o.emp_code', 'o.full_name'])
      .where('c.shift_log_id', '=', shiftLogId)
      .orderBy('c.crew_id', 'asc')
      .execute();

    return rows.map((r) => ({
      id: String(r.crew_id),
      operatorId: String(r.operator_id),
      empCode: r.emp_code,
      operatorName: r.full_name,
      roleCode: r.role_code,
    }));
  }

  static async create(payload: { shiftLogId: string; operatorId: string | number; roleCode: string }) {
    const validRoles = ['OPERATOR', 'ASST', 'HELPER', 'CRANE', 'MTL'];
    if (!validRoles.includes(payload.roleCode)) {
      throw new Error(`Invalid role code. Must be one of: ${validRoles.join(', ')}`);
    }

    const operatorPk = await this.resolveOperatorId(payload.operatorId);

    const row = await db
      .insertInto('txn.crew_entry')
      .values({
        shift_log_id: payload.shiftLogId,
        operator_id: operatorPk,
        role_code: payload.roleCode,
      })
      .returning('crew_id')
      .executeTakeFirstOrThrow();

    return String(row.crew_id);
  }
}

export class DefectService {
  static async create(payload: any, _userId: string) {
    let processId = payload.processId;
    let entryId = payload.entryId;

    if (payload.shiftLogId && !processId) {
      const log = await db
        .selectFrom('txn.shift_log')
        .select('process_id')
        .where('shift_log_id', '=', payload.shiftLogId)
        .executeTakeFirst();
      if (!log) throw new Error('Shift log not found');
      processId = log.process_id;
      entryId = entryId ?? payload.shiftLogId;
    }

    if (!processId) throw new Error('processId or shiftLogId is required');
    if (!entryId) throw new Error('entryId is required');
    if (!payload.defectCode) throw new Error('defectCode is required');

    const row = await db
      .insertInto('txn.defect_entry')
      .values({
        process_id: processId,
        entry_id: entryId,
        coil_no: payload.coilNo ?? payload.coilNumber ?? null,
        defect_code: payload.defectCode,
        location: payload.location ?? null,
        qty_mt: payload.quantityMt ?? payload.qty_mt ?? null,
      })
      .returning('defect_id')
      .executeTakeFirstOrThrow();

    return String(row.defect_id);
  }
}
