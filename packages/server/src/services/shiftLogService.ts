import { db } from '../db';
import {
  ShiftLogState,
  formatDbDate,
  formatPlantDate,
  nextPlantShift,
  parsePlantDateOnly,
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
      3: 'archive.prod_crm',
      4: 'txn.ann_charge',
      5: 'archive.prod_skp',
      6: 'txn.prod_rwd',
      7: 'txn.prod_crs',
      8: 'txn.prod_ctl',
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
        fromTime: s.start_at ? new Date(s.start_at).toISOString().substring(11, 16) : '',
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
