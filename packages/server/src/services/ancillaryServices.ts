import { sql } from 'kysely';
import { db } from '../db';
import { assertQuantityWithinProduction } from '../validation/manufacturingValidation';
import { publishDefectLogged } from '../platform/m1Events';

export { StoppageService } from './StoppageService';

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
  static async create(payload: {
    processId?: number | string;
    entryId?: number | string;
    shiftLogId?: number | string;
    defectCode?: string;
    coilNo?: string;
    coilNumber?: string;
    location?: string;
    quantityMt?: number | string;
    qty_mt?: number | string;
  }, _userId: string) {
    let processId = payload.processId;
    let entryId = payload.entryId;

    let shiftCode: string | undefined;
    let prodDate: Date | undefined;
    const shiftLogId = payload.shiftLogId == null ? null : String(payload.shiftLogId);

    if (shiftLogId && !processId) {
      const log = await db
        .selectFrom('txn.shift_log')
        .select(['process_id', 'shift_code', 'prod_date'])
        .where('shift_log_id', '=', shiftLogId)
        .executeTakeFirst();
      if (!log) throw new Error('Shift log not found');
      processId = log.process_id;
      shiftCode = log.shift_code;
      prodDate = log.prod_date instanceof Date ? log.prod_date : new Date(log.prod_date);
      entryId = entryId ?? shiftLogId;
    }

    if (!processId) throw new Error('processId or shiftLogId is required');
    if (!entryId) throw new Error('entryId is required');
    if (!payload.defectCode) throw new Error('defectCode is required');

    const qtyMt = payload.quantityMt ?? payload.qty_mt ?? null;
    if (qtyMt != null && shiftLogId) {
      const log = await db
        .selectFrom('txn.shift_log')
        .select(['total_prod_mt', 'target_mt'])
        .where('shift_log_id', '=', shiftLogId)
        .executeTakeFirst();
      const productionMt = Number(log?.total_prod_mt ?? log?.target_mt ?? 0);
      assertQuantityWithinProduction(Number(qtyMt), productionMt, 'Defect quantity');
    }

    const processIdNumber = Number(processId);
    if (!Number.isInteger(processIdNumber) || processIdNumber <= 0) {
      throw new Error('processId must be a positive integer');
    }

    const result = await sql<{ defect_id: string }>`
      INSERT INTO txn.defect_entry (
        process_id,
        entry_id,
        coil_no,
        defect_code,
        location,
        qty_mt,
        shift_code,
        prod_date
      )
      VALUES (
        ${processIdNumber},
        ${String(entryId)},
        ${payload.coilNo ?? payload.coilNumber ?? null},
        ${payload.defectCode},
        ${payload.location ?? null},
        ${qtyMt == null ? null : Number(qtyMt)},
        ${shiftCode ?? null},
        ${prodDate ?? null}
      )
      RETURNING defect_id
    `.execute(db);

    const row = result.rows[0];
    if (!row) throw new Error('Failed to create defect entry');

    const defectId = String(row.defect_id);
    void publishDefectLogged({
      defectId,
      processId: processIdNumber,
      entryId: String(entryId),
      coilNo: payload.coilNo ?? payload.coilNumber,
      defectCode: payload.defectCode,
      quantityMt: qtyMt == null ? undefined : Number(qtyMt),
    }).catch((error) => {
      console.error('[M1] failed to publish defect.logged', error);
    });

    return defectId;
  }
}
