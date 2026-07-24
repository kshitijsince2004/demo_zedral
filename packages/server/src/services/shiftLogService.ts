import { db } from '../db';
import {
  ShiftLogState,
  formatDbDate,
  formatPlantDate,
  formatPlantTime,
  nextPlantShift,
  parsePlantDateOnly,
  postgresDateOnly,
} from '@m1/shared-validation';
import {
  ShiftLogValidationService,
  ValidationGateContext,
} from './shiftLogValidationService';
import { publishShiftClosed } from '../platform/m1Events';

export interface ShiftLogPayload {
  processId: number;
  productionDate: Date;
  shiftCode: string;
  millType?: string;
  supervisorId: number;
}

export interface HandoverSummary {
  shiftLogId: string;
  processId: number;
  prodDate: Date;
  shiftCode: string;
  state: string;
  targetMt: number;
  producedMt: number;
  openCoils: string[];
  openCoilCount: number;
  runningStoppages: {
    id: string;
    reason: string;
    fromTime: string;
    remarks: string | null;
  }[];
  runningStoppageCount: number;
  nextShift: { shiftCode: string; prodDate: Date };
  notes: string;
}

export class ShiftLogService {
  /**
   * shift_manager_id references master.operator(operator_id), not app_user.
   * After clear:data the operator table may be empty — auto-provision from app_user.
   */
  static async resolveShiftManagerId(appUserId?: number): Promise<number | null> {
    if (!appUserId) return null;

    const user = await db
      .selectFrom('security.app_user')
      .select(['emp_code', 'full_name', 'username'])
      .where('user_id', '=', appUserId)
      .executeTakeFirst();
    if (!user) return null;

    const empCode = user.emp_code?.trim() || user.username?.trim() || `U${appUserId}`;

    const existing = await db
      .selectFrom('master.operator')
      .select('operator_id')
      .where('emp_code', '=', empCode)
      .executeTakeFirst();
    if (existing) return Number(existing.operator_id);

    const created = await db
      .insertInto('master.operator')
      .values({
        emp_code: empCode,
        full_name: user.full_name?.trim() || user.username || empCode,
      })
      .returning('operator_id')
      .executeTakeFirstOrThrow();

    return Number(created.operator_id);
  }

  /**
   * Creates a new Shift Log in DRAFT state.
   */
  static async create(payload: ShiftLogPayload) {
    // Always write calendar YYYY-MM-DD — Date objects at IST midnight become the previous
    // UTC calendar day when Postgres casts timestamptz → DATE on UTC hosts.
    const prodDate = postgresDateOnly(payload.productionDate) as any;

    let query = db.selectFrom('txn.shift_log')
      .selectAll()
      .where('prod_date', '=', prodDate)
      .where('shift_code', '=', payload.shiftCode)
      .where('process_id', '=', payload.processId);

    if (payload.millType) {
        query = query.where('mill_type', '=', payload.millType);
    } else {
        query = query.where('mill_type', 'is', null);
    }

    const existing = await query.executeTakeFirst();

    if (existing) {
      return existing.shift_log_id;
    }

    const shiftManagerId = await this.resolveShiftManagerId(payload.supervisorId);

    const result = await db
      .insertInto('txn.shift_log')
      .values({
        process_id: payload.processId,
        prod_date: prodDate,
        shift_code: payload.shiftCode,
        mill_type: payload.millType || null,
        shift_manager_id: shiftManagerId,
        state: ShiftLogState.DRAFT
      })
      .returning('shift_log_id')
      .executeTakeFirstOrThrow();

    return result.shift_log_id;
  }

  static async submit(id: string, context?: ValidationGateContext) {
    const shiftLogId = String(id);
    const log = await this.getById(shiftLogId);
    if (!log || (log.state !== ShiftLogState.DRAFT && log.state !== ShiftLogState.REOPENED)) {
      throw new Error('Shift log can only be submitted from DRAFT or REOPENED state.');
    }

    await ShiftLogValidationService.assertValid(shiftLogId, context);

    const { ValidationConfigService } = await import('./ValidationConfigService');
    const configService = new ValidationConfigService(db);
    const currentVersion = await configService.getVersion();

    const actualProd = await this.calculateActualProduction(shiftLogId, log.process_id);

    await db
      .updateTable('txn.shift_log')
      .set({ 
        state: ShiftLogState.SUBMITTED, 
        submitted_at: new Date(), 
        ruleset_version: currentVersion,
        total_prod_mt: actualProd
      })
      .where('shift_log_id', '=', shiftLogId)
      .execute();

    void publishShiftClosed({
      shiftLogId,
      processId: log.process_id,
      totalProdMt: actualProd,
    }).catch((error) => {
      console.error('[M1] failed to publish shift.closed', error);
    });
  }

  /**
   * Machine-head shift review closure — marks DRAFT/REOPENED as SUBMITTED without
   * the operator validation gate (optional remarks stored in shift_event_audit).
   */
  static async completeFromReview(
    id: string,
    userId: number,
    remarks?: string,
  ): Promise<void> {
    const shiftLogId = String(id);
    const log = await this.getById(shiftLogId);
    if (!log) {
      throw new Error('Shift log not found');
    }
    // Idempotent: outbox may replay complete after the first success.
    if (log.state === ShiftLogState.SUBMITTED || log.state === ShiftLogState.APPROVED) {
      return;
    }
    if (log.state !== ShiftLogState.DRAFT && log.state !== ShiftLogState.REOPENED) {
      throw new Error('Only active (DRAFT or REOPENED) shifts can be marked completed.');
    }

    const actualProd = await this.calculateActualProduction(shiftLogId, log.process_id);
    const trimmedRemarks = remarks?.trim() || null;

    await db
      .updateTable('txn.shift_log')
      .set({
        state: ShiftLogState.SUBMITTED,
        submitted_at: new Date(),
        total_prod_mt: actualProd,
        shift_manager_id: log.shift_manager_id ?? userId,
      })
      .where('shift_log_id', '=', shiftLogId)
      .execute();

    await db
      .insertInto('txn.shift_event_audit')
      .values({
        event_type: 'SHIFT_COMPLETED',
        entity_type: 'shift_log',
        entity_id: shiftLogId,
        user_id: userId,
        payload: {
          remarks: trimmedRemarks,
          totalProdMt: actualProd,
          fromState: log.state,
        },
      })
      .execute();

    void publishShiftClosed({
      shiftLogId,
      processId: log.process_id,
      totalProdMt: actualProd,
    }).catch((error) => {
      console.error('[M1] failed to publish shift.closed', error);
    });

    // SPEC2 §10/§12 — resolve MH auto-handover notifications on sign-off.
    void import('./DeskNotificationService')
      .then(({ DeskNotificationService }) =>
        DeskNotificationService.resolveForShiftLog(shiftLogId),
      )
      .catch((error) => {
        console.error('[M1] failed to resolve desk notifications', error);
      });
  }

  /**
   * SPEC2 §13 — MH backfill of coolant/scrap/remarks for AUTO_COMPLETED shifts only.
   * Rejects overwrite on manually-completed (non-boundary) handovers.
   */
  static async updateManualFields(
    shiftLogId: string,
    userId: number,
    fields: {
      scrapKg?: number | null;
      coolantTempDegC?: number | null;
      coolantPressKgCm2?: number | null;
      remarks?: string | null;
    },
  ): Promise<void> {
    const id = String(shiftLogId);

    const boundary = await db
      .selectFrom('txn.machine_handover as h')
      .innerJoin('txn.machine_shift_session as s', (join) =>
        join
          .onRef('s.machine_code', '=', 'h.machine_code')
          .onRef('s.shift_code', '=', 'h.outgoing_shift_code'),
      )
      .select(['h.handover_id', 'h.remarks', 'h.status', 'h.created_by_boundary'])
      .where('s.shift_log_id', '=', id as any)
      .where('h.created_by_boundary', '=', true)
      .where('h.status', '=', 'AUTO_COMPLETED')
      .executeTakeFirst();

    if (!boundary) {
      throw new Error(
        'Manual field backfill is only allowed for AUTO_COMPLETED (system) handovers awaiting review.',
      );
    }

    const existing = await db
      .selectFrom('txn.crm_shift_summary')
      .selectAll()
      .where('shift_log_id', '=', id as any)
      .executeTakeFirst();

    const scrap =
      fields.scrapKg !== undefined
        ? fields.scrapKg
        : existing?.scrap_kg != null
          ? Number(existing.scrap_kg)
          : null;
    const coolantTemp =
      fields.coolantTempDegC !== undefined
        ? fields.coolantTempDegC
        : existing?.coolant_temp_degc != null
          ? Number(existing.coolant_temp_degc)
          : null;
    const coolantPress =
      fields.coolantPressKgCm2 !== undefined
        ? fields.coolantPressKgCm2
        : existing?.coolant_press_kgcm2 != null
          ? Number(existing.coolant_press_kgcm2)
          : null;

    if (existing) {
      await db
        .updateTable('txn.crm_shift_summary')
        .set({
          scrap_kg: scrap as any,
          coolant_temp_degc: coolantTemp as any,
          coolant_press_kgcm2: coolantPress as any,
          submitted_by: userId,
          submitted_at: new Date(),
        })
        .where('shift_log_id', '=', id as any)
        .execute();
    } else {
      await db
        .insertInto('txn.crm_shift_summary')
        .values({
          shift_log_id: id as any,
          scrap_kg: scrap as any,
          coolant_temp_degc: coolantTemp as any,
          coolant_press_kgcm2: coolantPress as any,
          submitted_by: userId,
          submitted_at: new Date(),
        })
        .execute();
    }

    if (fields.remarks != null && fields.remarks.trim()) {
      await db
        .updateTable('txn.machine_handover')
        .set({ remarks: fields.remarks.trim() })
        .where('handover_id', '=', boundary.handover_id)
        .execute();
    }

    await db
      .insertInto('txn.shift_event_audit')
      .values({
        event_type: 'SHIFT_MANUAL_FIELDS_BACKFILL',
        entity_type: 'shift_log',
        entity_id: id,
        user_id: userId,
        payload: {
          scrapKg: scrap,
          coolantTempDegC: coolantTemp,
          coolantPressKgCm2: coolantPress,
          remarks: fields.remarks?.trim() ?? null,
          handoverId: String(boundary.handover_id),
        },
      })
      .execute();
  }

  /** SPEC2 §13 B3 — operator in-shift readings upsert into crm_shift_summary. */
  static async upsertShiftReadings(
    shiftLogId: string,
    userId: number,
    fields: {
      scrapKg?: number | null;
      coolantTempDegC?: number | null;
      coolantPressKgCm2?: number | null;
    },
  ): Promise<void> {
    const id = String(shiftLogId);
    const existing = await db
      .selectFrom('txn.crm_shift_summary')
      .selectAll()
      .where('shift_log_id', '=', id as any)
      .executeTakeFirst();

    const scrap =
      fields.scrapKg !== undefined
        ? fields.scrapKg
        : existing?.scrap_kg != null
          ? Number(existing.scrap_kg)
          : null;
    const coolantTemp =
      fields.coolantTempDegC !== undefined
        ? fields.coolantTempDegC
        : existing?.coolant_temp_degc != null
          ? Number(existing.coolant_temp_degc)
          : null;
    const coolantPress =
      fields.coolantPressKgCm2 !== undefined
        ? fields.coolantPressKgCm2
        : existing?.coolant_press_kgcm2 != null
          ? Number(existing.coolant_press_kgcm2)
          : null;

    if (existing) {
      await db
        .updateTable('txn.crm_shift_summary')
        .set({
          scrap_kg: scrap as any,
          coolant_temp_degc: coolantTemp as any,
          coolant_press_kgcm2: coolantPress as any,
          submitted_by: userId,
          submitted_at: new Date(),
        })
        .where('shift_log_id', '=', id as any)
        .execute();
    } else {
      await db
        .insertInto('txn.crm_shift_summary')
        .values({
          shift_log_id: id as any,
          scrap_kg: scrap as any,
          coolant_temp_degc: coolantTemp as any,
          coolant_press_kgcm2: coolantPress as any,
          submitted_by: userId,
          submitted_at: new Date(),
        })
        .execute();
    }

    await db
      .insertInto('txn.shift_event_audit')
      .values({
        event_type: 'SHIFT_READINGS_UPSERT',
        entity_type: 'shift_log',
        entity_id: id,
        user_id: userId,
        payload: { scrapKg: scrap, coolantTempDegC: coolantTemp, coolantPressKgCm2: coolantPress },
      })
      .execute();
  }

  static async approve(id: string, approverId: number) {
    const shiftLogId = String(id);
    const log = await this.getById(shiftLogId);
    if (!log || log.state !== ShiftLogState.SUBMITTED) {
      throw new Error('Shift log can only be approved from SUBMITTED state.');
    }

    await ShiftLogValidationService.assertValid(shiftLogId);

    await db
      .updateTable('txn.shift_log')
      .set({ 
        state: ShiftLogState.APPROVED, 
        approver_id: approverId, 
        approved_at: new Date()
      })
      .where('shift_log_id', '=', shiftLogId)
      .execute();
  }

  static async reopen(id: string) {
    const shiftLogId = String(id);
    const log = await this.getById(shiftLogId);
    if (!log || log.state !== ShiftLogState.APPROVED) {
      throw new Error('Shift log can only be reopened from APPROVED state.');
    }

    await db
      .updateTable('txn.shift_log')
      .set({ state: ShiftLogState.REOPENED })
      .where('shift_log_id', '=', shiftLogId)
      .execute();
  }

  static async reject(id: string, rejectorId: number, note: string) {
    const shiftLogId = String(id);
    const log = await this.getById(shiftLogId);
    if (!log || log.state !== ShiftLogState.SUBMITTED) {
      throw new Error('Shift log can only be rejected from SUBMITTED state.');
    }

    await db
      .updateTable('txn.shift_log')
      .set({ 
        state: ShiftLogState.DRAFT, 
        /* reject_reason: note */ 
      })
      .where('shift_log_id', '=', shiftLogId)
      .execute();
  }


  
  static getNextShift(currentShiftCode: string, currentDate: Date): { nextShiftCode: string, nextProdDate: Date } {
    const currentDateStr = formatPlantDate(currentDate);
    const next = nextPlantShift(currentShiftCode, currentDateStr);
    return {
      nextShiftCode: next.shiftCode,
      nextProdDate: parsePlantDateOnly(next.prodDate),
    };
  }

  static getProcessTable(processId: number): string | null {
    const map: Record<number, string> = {
      1: 'txn.prod_hrs',
      2: 'txn.prod_pkl',
      3: 'txn.crm_order',
      4: 'txn.ann_charge',
      5: 'txn.crm_order',
      6: 'txn.prod_rwd',
      7: 'txn.prod_crs',
      8: 'txn.prod_ctl',
      31: 'txn.crm_order',
    };
    return map[processId] || null;
  }

  static async getHandoverSummary(shiftLogId: string): Promise<HandoverSummary> {
    const log = await this.getById(shiftLogId);
    if (!log) {
      throw new Error('Shift log not found');
    }

    const openCoils = await this.listOpenCoils(shiftLogId, log.process_id);
    const runningStoppages = await db
      .selectFrom('txn.stoppage as se')
      .innerJoin('master.stoppage_code as sc', 'se.breakdown_code', 'sc.stoppage_code')
      .select([
        'se.stoppage_id as id',
        'sc.description as reason',
        'se.start_at',
        'se.remarks',
      ])
      .where('se.shift_log_id', '=', String(shiftLogId))
      .where('se.end_at', 'is', null)
      .execute();

    const prodDateStr = formatDbDate(log.prod_date);
    const { nextShiftCode, nextProdDate } = this.getNextShift(
      log.shift_code,
      parsePlantDateOnly(prodDateStr),
    );

    const producedMt = await this.calculateActualProduction(String(log.shift_log_id), log.process_id);

    return {
      shiftLogId: String(log.shift_log_id),
      processId: log.process_id,
      prodDate: parsePlantDateOnly(prodDateStr),
      shiftCode: log.shift_code,
      state: log.state,
      targetMt: Number(log.target_mt || 0),
      producedMt: producedMt,
      openCoils,
      openCoilCount: openCoils.length,
      runningStoppages: runningStoppages.map((s) => ({
        id: String(s.id),
        reason: s.reason,
        fromTime: s.start_at ? formatPlantTime(new Date(s.start_at)) : '',
        remarks: s.remarks,
      })),
      runningStoppageCount: runningStoppages.length,
      nextShift: { shiftCode: nextShiftCode, prodDate: nextProdDate },
      notes: '',
    };
  }

  private static async listOpenCoils(shiftLogId: string, processId: number): Promise<string[]> {
    const processTable = this.getProcessTable(processId);
    if (!processTable) return [];

    if (processTable === 'txn.ann_charge') {
      const rows = await db
        .selectFrom('txn.ann_charge')
        .select('charge_no')
        .where('shift_log_id', '=', shiftLogId)
        .where('status', '=', 'IN_PROCESS')
        .execute();
      return rows.map((r) => r.charge_no);
    }

    if (processTable === 'txn.crm_order') {
      const rows = await db
        .selectFrom('txn.crm_order')
        .select('coil_no')
        .where('shift_log_id', '=', shiftLogId)
        .where('status', 'in', ['QUEUED', 'IN_PROGRESS', 'ACTIVE'])
        .execute();
      return rows.map((r) => r.coil_no);
    }

    const rows = await db
      .selectFrom(processTable as 'txn.prod_hrs')
      .select('coil_no')
      .where('shift_log_id', '=', shiftLogId)
      .where('time_to', 'is', null)
      .execute();
    return rows.map((r) => r.coil_no);
  }

  static async calculateActualProduction(shiftLogId: string, processId: number): Promise<number> {
    const processTable = this.getProcessTable(processId);
    if (!processTable) return 0;

    if (processTable === 'txn.crm_order') {
      const { SixHiShiftService } = await import('./sixHi');
      return SixHiShiftService.getProducedMt(shiftLogId);
    }

    if (processTable === 'txn.ann_charge') {
      const rows = await db.selectFrom('txn.ann_charge')
        .select('charge_wt_mt')
        .where('shift_log_id', '=', shiftLogId)
        .execute();
      let total = 0;
      for (const r of rows) {
        if (r.charge_wt_mt != null) {
          total += Number(r.charge_wt_mt);
        }
      }
      return total;
    }

    let weightCol = 'weight_mt';
    if (processTable === 'txn.prod_crs') {
      weightCol = 'output_wt_mt';
    }

    const rows = await db.selectFrom(processTable as any)
      .select(weightCol as any)
      .where('shift_log_id', '=', shiftLogId)
      .execute();

    let total = 0;
    for (const r of rows) {
      const wt = (r as any)[weightCol];
      if (wt != null) {
        total += Number(wt);
      }
    }
    return total;
  }

  static async getById(id: string | string) {
    return await db
      .selectFrom('txn.shift_log')
      .selectAll()
      .where('shift_log_id', '=', String(id))
      .executeTakeFirst();
  }

  static async getOverrides(shiftLogId: string) {
    return await db
      .selectFrom('txn.validation_overrides as vo')
      .innerJoin('security.app_user as u', 'vo.override_by', 'u.user_id')
      .select(['vo.field_path', 'vo.reason', 'vo.created_at', 'u.full_name as override_by_name'])
      .where('vo.shift_log_id', '=', String(shiftLogId))
      .execute();
  }
}
