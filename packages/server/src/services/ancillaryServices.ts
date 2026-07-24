import { sql } from 'kysely';
import { db } from '../db';
import { assertQuantityWithinProduction } from '../validation/manufacturingValidation';
import { publishDefectLogged } from '../platform/m1Events';

export { StoppageService } from './StoppageService';

export class CrewService {
  static async resolveOperatorInfo(operatorId: string | number): Promise<{ id: number; name: string }> {
    const asNum = Number(operatorId);
    if (!Number.isNaN(asNum) && asNum > 0) {
      const byId = await db
        .selectFrom('master.operator')
        .select(['operator_id', 'full_name'])
        .where('operator_id', '=', asNum)
        .executeTakeFirst();
      if (byId) return { id: Number(byId.operator_id), name: byId.full_name };
    }

    const byCode = await db
      .selectFrom('master.operator')
      .select(['operator_id', 'full_name'])
      .where('emp_code', '=', String(operatorId))
      .executeTakeFirst();

    if (!byCode) throw new Error(`Operator not found: ${operatorId}`);
    return { id: Number(byCode.operator_id), name: byCode.full_name };
  }

  static async listByShiftLog(shiftLogId: string) {
    const rows = await db
      .selectFrom('txn.session_crew as sc')
      .innerJoin('txn.machine_shift_session as mss', 'mss.session_id', 'sc.session_id')
      .innerJoin('master.machine_crew_roster as mcr', 'mcr.crew_id', 'sc.crew_id')
      .select(['sc.session_crew_id', 'sc.session_id', 'mcr.crew_id', 'mcr.member_name', 'mcr.role_label'])
      .where('mss.shift_log_id', '=', String(shiftLogId))
      .orderBy('sc.session_crew_id', 'asc')
      .execute();

    return rows.map((r) => ({
      id: String(r.session_crew_id), // back-compat
      crewId: String(r.crew_id),
      operatorName: r.member_name,
      roleCode: r.role_label,
    }));
  }

  static async listBySession(sessionId: string) {
    const rows = await db
      .selectFrom('txn.session_crew as sc')
      .innerJoin('master.machine_crew_roster as mcr', 'mcr.crew_id', 'sc.crew_id')
      .select(['sc.session_crew_id', 'mcr.crew_id', 'mcr.member_name', 'mcr.role_label'])
      .where('sc.session_id', '=', String(sessionId))
      .orderBy('sc.session_crew_id', 'asc')
      .execute();

    return rows.map((r) => ({
      sessionCrewId: String(r.session_crew_id),
      crewId: String(r.crew_id),
      memberName: r.member_name,
      roleLabel: r.role_label,
    }));
  }

  static async create(payload: { shiftLogId: string; operatorId: string | number; roleCode: string }) {
    const validRoles = ['OPERATOR', 'ASST', 'HELPER', 'CRANE', 'MTL'];
    if (!validRoles.includes(payload.roleCode)) {
      throw new Error(`Invalid role code. Must be one of: ${validRoles.join(', ')}`);
    }

    const operator = await this.resolveOperatorInfo(payload.operatorId);

    // 1. Get session and machine from shiftLogId
    const session = await db
      .selectFrom('txn.machine_shift_session')
      .select(['session_id', 'machine_code'])
      .where('shift_log_id', '=', String(payload.shiftLogId))
      .executeTakeFirst();
      
    if (!session) throw new Error('No active session found for this shift log');

    // 2. Resolve or create roster entry for this machine
    let rosterEntry = await db
      .selectFrom('master.machine_crew_roster')
      .select('crew_id')
      .where('machine_code', '=', session.machine_code)
      .where('member_name', '=', operator.name)
      .where('role_label', '=', payload.roleCode)
      .executeTakeFirst();

    if (!rosterEntry) {
      rosterEntry = await db
        .insertInto('master.machine_crew_roster')
        .values({
          machine_code: session.machine_code,
          member_name: operator.name,
          role_label: payload.roleCode,
        })
        .returning('crew_id')
        .executeTakeFirstOrThrow();
    }

    // 3. Insert session_crew
    const row = await db
      .insertInto('txn.session_crew')
      .values({
        session_id: session.session_id,
        crew_id: rosterEntry.crew_id,
      })
      .returning('session_crew_id')
      .executeTakeFirstOrThrow();

    return String(row.session_crew_id);
  }

  /** Attach roster members to a session (crew-at-login). Idempotent on crew_id. */
  static async attachRosterToSession(sessionId: string, crewIds: Array<string | number>) {
    const ids = [...new Set(crewIds.map(Number).filter((n) => n > 0))];
    if (ids.length === 0) throw new Error('At least one crew member is required');

    const session = await db
      .selectFrom('txn.machine_shift_session')
      .select(['session_id', 'machine_code'])
      .where('session_id', '=', String(sessionId))
      .executeTakeFirst();
    if (!session) throw new Error('Session not found');

    const roster = await db
      .selectFrom('master.machine_crew_roster')
      .select('crew_id')
      .where('machine_code', '=', session.machine_code)
      .where('crew_id', 'in', ids.map(String))
      .execute();
    if (roster.length === 0) throw new Error('No matching roster members for this machine');

    for (const r of roster) {
      const existing = await db
        .selectFrom('txn.session_crew')
        .select('session_crew_id')
        .where('session_id', '=', session.session_id)
        .where('crew_id', '=', r.crew_id)
        .executeTakeFirst();
      if (existing) continue;
      await db
        .insertInto('txn.session_crew')
        .values({ session_id: session.session_id, crew_id: r.crew_id })
        .execute();
    }
    return roster.length;
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
