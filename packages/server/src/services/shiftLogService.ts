import { db } from '../db';
import { ShiftLogState } from '@m1/shared-validation';
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

export interface HandoverContext {
  incomingUserId: number;
  outgoingUserId: number;
  notes?: string;
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
    let query = db.selectFrom('txn.shift_log')
      .selectAll()
      .where('prod_date', '=', payload.productionDate)
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
        prod_date: payload.productionDate,
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
    let nextShiftCode = '';
    let nextProdDate = new Date(currentDate);

    if (currentShiftCode === 'A') {
      nextShiftCode = 'B';
    } else if (currentShiftCode === 'B') {
      nextShiftCode = 'C';
    } else if (currentShiftCode === 'C') {
      nextShiftCode = 'A';
      nextProdDate.setDate(nextProdDate.getDate() + 1);
    } else {
      nextShiftCode = currentShiftCode;
    }

    return { nextShiftCode, nextProdDate };
  }

  static getProcessTable(processId: number): string | null {
    const map: Record<number, string> = {
      1: 'txn.prod_hrs',
      2: 'txn.prod_pkl',
      3: 'txn.prod_crm',
      4: 'txn.ann_charge',
      5: 'txn.prod_skp',
      6: 'txn.prod_rwd',
      7: 'txn.prod_crs',
      8: 'txn.prod_ctl',
      9: 'txn.prod_glv',
      31: 'txn.crm6_order',
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
      .selectFrom('txn.stoppage_entry as se')
      .innerJoin('master.stoppage_code as sc', 'se.stoppage_code', 'sc.stoppage_code')
      .select([
        'se.stoppage_id as id',
        'sc.description as reason',
        'se.time_from as fromTime',
        'se.remarks',
      ])
      .where('se.shift_log_id', '=', String(shiftLogId))
      .where('se.time_to', 'is', null)
      .execute();

    const { nextShiftCode, nextProdDate } = this.getNextShift(
      log.shift_code,
      new Date(log.prod_date)
    );

    const producedMt = await this.calculateActualProduction(String(log.shift_log_id), log.process_id);

    return {
      shiftLogId: String(log.shift_log_id),
      processId: log.process_id,
      prodDate: new Date(log.prod_date),
      shiftCode: log.shift_code,
      state: log.state,
      targetMt: Number(log.target_mt || 0),
      producedMt: producedMt,
      openCoils,
      openCoilCount: openCoils.length,
      runningStoppages: runningStoppages.map((s) => ({
        id: String(s.id),
        reason: s.reason,
        fromTime: String(s.fromTime),
        remarks: s.remarks,
      })),
      runningStoppageCount: runningStoppages.length,
      nextShift: { shiftCode: nextShiftCode, prodDate: nextProdDate },
      notes: log.handover_notes ?? '',
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

    if (processTable === 'txn.crm6_order') {
      const rows = await db.selectFrom('txn.crm6_order as o')
        .leftJoin('txn.crm6_rolling as r', 'r.order_id', 'o.order_id')
        .leftJoin('txn.crm6_skinpass as s', 's.order_id', 'o.order_id')
        .select([
          'o.sub_process',
          'r.actual_weight_mt as roll_wt',
          's.actual_weight_mt as skp_wt',
          'o.ppc_weight_mt as ppc_wt',
        ])
        .where('o.shift_log_id', '=', shiftLogId)
        .where('o.status', '=', 'COMPLETED')
        .execute();

      let total = 0;
      for (const r of rows) {
        const wt = r.sub_process === 'ROLLING' ? r.roll_wt : r.skp_wt;
        const finalWt = wt != null ? wt : r.ppc_wt;
        if (finalWt != null) {
          total += Number(finalWt);
        }
      }
      return total;
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

  static async handover(currentShiftLogId: string, context: HandoverContext) {
    const currentLog = await this.getById(currentShiftLogId);
    if (!currentLog) {
      throw new Error('Current shift log not found');
    }
    if (currentLog.state !== ShiftLogState.DRAFT && currentLog.state !== ShiftLogState.REOPENED) {
      throw new Error('Shift log must be DRAFT to perform handover');
    }

    const { ShiftDetectionService } = await import('./ShiftDetectionService');
    const windows = await ShiftDetectionService.listShiftWindows();
    const window = windows.find(w => w.shift_code === currentLog.shift_code);
    if (window) {
      const { resolveShiftWindowBounds } = await import('../validation/manufacturingValidation');
      const bounds = resolveShiftWindowBounds(currentLog.prod_date as Date, window.start_time, window.end_time);
      if (Date.now() < bounds.end.getTime()) {
        throw new Error(`Shift handover cannot be completed before the current shift's scheduled end time (${window.end_time}).`);
      }
    }

    const { nextShiftCode, nextProdDate } = this.getNextShift(
      currentLog.shift_code,
      new Date(currentLog.prod_date)
    );

    await ShiftLogValidationService.assertValid(String(currentShiftLogId));

    const handoverAt = new Date();
    const incomingManagerId = await this.resolveShiftManagerId(context.incomingUserId);

    const { ValidationConfigService } = await import('./ValidationConfigService');
    const configService = new ValidationConfigService(db);
    const currentVersion = await configService.getVersion();

    const actualProd = await this.calculateActualProduction(String(currentShiftLogId), currentLog.process_id);

    const newShiftLogId = await db.transaction().execute(async (trx) => {
      // 1. Close outgoing shift with attestation
      await trx
        .updateTable('txn.shift_log')
        .set({
          state: ShiftLogState.SUBMITTED,
          submitted_at: handoverAt,
          ruleset_version: currentVersion,
          handover_notes: context.notes?.trim() || null,
          handover_outgoing_user_id: context.outgoingUserId,
          handover_incoming_user_id: context.incomingUserId,
          handover_at: handoverAt,
          total_prod_mt: actualProd
        })
        .where('shift_log_id', '=', String(currentShiftLogId))
        .execute();

      // 2. Create incoming shift linked to outgoing
      const newShift = await trx
        .insertInto('txn.shift_log')
        .values({
          process_id: currentLog.process_id,
          prod_date: nextProdDate,
          shift_code: nextShiftCode,
          mill_type: currentLog.mill_type,
          shift_manager_id: incomingManagerId,
          prev_shift_log_id: String(currentShiftLogId),
          state: ShiftLogState.DRAFT,
        })
        .returning('shift_log_id')
        .executeTakeFirstOrThrow();

      const newShiftLogId = newShift.shift_log_id;

      // 3. Carry forward running stoppages
      await trx
        .updateTable('txn.stoppage_entry')
        .set({ shift_log_id: newShiftLogId })
        .where('shift_log_id', '=', String(currentShiftLogId))
        .where('time_to', 'is', null)
        .execute();

      // 4. Carry forward open production entries
      const processTable = this.getProcessTable(currentLog.process_id);
      if (processTable) {
        if (processTable === 'txn.ann_charge') {
          await trx
            .updateTable('txn.ann_charge' as 'txn.ann_charge')
            .set({ shift_log_id: newShiftLogId })
            .where('shift_log_id', '=', String(currentShiftLogId))
            .where('status', '=', 'IN_PROCESS')
            .execute();
        } else {
          await trx
            .updateTable(processTable as 'txn.prod_hrs')
            .set({ shift_log_id: newShiftLogId })
            .where('shift_log_id', '=', String(currentShiftLogId))
            .where('time_to', 'is', null)
            .execute();
        }
      }

      return String(newShiftLogId);
    });

    void publishShiftClosed({
      shiftLogId: String(currentShiftLogId),
      processId: currentLog.process_id,
      totalProdMt: actualProd,
      closedAt: handoverAt,
    }).catch((error) => {
      console.error('[M1] failed to publish shift.closed', error);
    });

    return newShiftLogId;
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
