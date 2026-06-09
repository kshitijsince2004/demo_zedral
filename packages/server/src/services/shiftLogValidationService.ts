import { db } from '../db';
import {
  validateShiftLogSubmission,
  canOverride,
  ValidationResult,
  UserRole,
  ShiftLogState,
  computeEffectiveRuleset,
} from '@m1/shared-validation';
import { ShiftLogService } from './shiftLogService';
import { ValidationConfigService } from './ValidationConfigService';
import { persistOverrides, OverrideRequest } from './overrideService';
import { AuthUser } from './authService';
import {
  mapAnnEntry,
  mapCrmEntry,
  mapCrsEntry,
  mapCtlEntry,
  mapGlvEntry,
  mapHrsEntry,
  mapPklEntry,
  mapRwdEntry,
  mapSkpEntry,
} from './shiftLogEntryMapper';

const PROCESS_ID_TO_CODE: Record<number, string> = {
  1: 'HRS',
  2: 'PKL',
  3: 'CRM',
  4: 'ANN',
  5: 'SKP',
  6: 'RWD',
  7: 'CRS',
  8: 'CTL',
  9: 'GLV',
  31: '6HI',
};

const CODE_TO_PROCESS_ID: Record<string, number> = Object.fromEntries(
  Object.entries(PROCESS_ID_TO_CODE).map(([id, code]) => [code, Number(id)])
);

export class ShiftLogValidationGateError extends Error {
  validationResult: ValidationResult;

  constructor(validationResult: ValidationResult) {
    super('Shift log validation failed');
    this.name = 'ShiftLogValidationGateError';
    this.validationResult = validationResult;
  }
}

export interface ValidationGateContext {
  overrides?: OverrideRequest[];
  user?: AuthUser;
}

/** Soft mode for pilot burn-in — set VALIDATION_STRICT=false to skip gates. */
export function isValidationStrict(): boolean {
  return process.env.VALIDATION_STRICT !== 'false';
}

export class ShiftLogValidationService {
  static async loadEntries(shiftLogId: string, processCode: string): Promise<unknown[]> {
    const table = ShiftLogService.getProcessTable(CODE_TO_PROCESS_ID[processCode]);

    if (!table) return [];

    const rows = await db
      .selectFrom(table as any)
      .selectAll()
      .where('shift_log_id', '=', shiftLogId)
      .execute();

    switch (processCode) {
      case 'HRS': {
        const entryIds = rows.map((r: any) => r.entry_id);
        const slits =
          entryIds.length > 0
            ? await db
                .selectFrom('txn.prod_hrs_slit')
                .selectAll()
                .where('entry_id', 'in', entryIds)
                .execute()
            : [];
        return rows.map((row: any) =>
          mapHrsEntry(
            row,
            shiftLogId,
            slits.filter((s) => String(s.entry_id) === String(row.entry_id))
          )
        );
      }
      case 'PKL':
        return rows.map((row: any) => mapPklEntry(row, shiftLogId));
      case 'CRM':
        return rows.map((row: any) => mapCrmEntry(row, shiftLogId));
      case 'ANN':
        return rows.map((row: any) => mapAnnEntry(row, shiftLogId));
      case 'SKP': {
        const entryIds = rows.map((r: any) => r.entry_id);
        const passes =
          entryIds.length > 0
            ? await db
                .selectFrom('txn.prod_skp_pass')
                .selectAll()
                .where('entry_id', 'in', entryIds)
                .execute()
            : [];
        return rows.map((row: any) =>
          mapSkpEntry(
            row,
            shiftLogId,
            passes.filter((p) => String(p.entry_id) === String(row.entry_id))
          )
        );
      }
      case 'RWD':
        return rows.map((row: any) => mapRwdEntry(row, shiftLogId));
      case 'CRS': {
        const entryIds = rows.map((r: any) => r.entry_id);
        const slits =
          entryIds.length > 0
            ? await db
                .selectFrom('txn.prod_crs_slit')
                .selectAll()
                .where('entry_id', 'in', entryIds)
                .execute()
            : [];
        return rows.map((row: any) =>
          mapCrsEntry(
            row,
            shiftLogId,
            slits.filter((s) => String(s.entry_id) === String(row.entry_id))
          )
        );
      }
      case 'CTL':
        return rows.map((row: any) => mapCtlEntry(row, shiftLogId));
      case 'GLV':
        return rows.map((row: any) => mapGlvEntry(row, shiftLogId));
      default:
        return [];
    }
  }

  static buildShiftLogPayload(log: any, processCode: string) {
    return {
      id: String(log.shift_log_id),
      processLine: processCode,
      productionDate: new Date(log.prod_date),
      shiftCode: log.shift_code,
      millType: log.mill_type ?? undefined,
      state: log.state as ShiftLogState,
      supervisorId: String(log.shift_manager_id ?? ''),
      targetMt: log.target_mt != null ? Number(log.target_mt) : undefined,
      lineInchargeId: log.line_incharge_id != null ? String(log.line_incharge_id) : undefined,
      shiftManagerId: log.shift_manager_id != null ? String(log.shift_manager_id) : undefined,
      approverId: log.approver_id != null ? String(log.approver_id) : undefined,
      submittedAt: log.submitted_at ? new Date(log.submitted_at) : undefined,
      approvedAt: log.approved_at ? new Date(log.approved_at) : undefined,
    };
  }

  static async validate(shiftLogId: string): Promise<ValidationResult> {
    const log = await ShiftLogService.getById(shiftLogId);
    if (!log) {
      return {
        isValid: false,
        errors: [{ field: 'shiftLog', message: 'Shift log not found', severity: 'BLOCK' }],
        warnings: [],
      };
    }

    const processCode = PROCESS_ID_TO_CODE[log.process_id];
    if (!processCode) {
      return {
        isValid: false,
        errors: [{ field: 'shiftLog.processLine', message: 'Unknown process line', severity: 'BLOCK' }],
        warnings: [],
      };
    }

    const shiftLogPayload = this.buildShiftLogPayload(log, processCode);
    const entries = await this.loadEntries(shiftLogId, processCode);

    // Fetch configurable rules
    const configService = new ValidationConfigService(db);
    const configuredRules = await configService.getConfiguredRules();
    const currentVersion = await configService.getVersion();
    
    let evaluationVersion = currentVersion;
    let versionSkew = false;

    // Use bound version for existing logs that are not DRAFT/REOPENED
    if (log.state !== ShiftLogState.DRAFT && log.state !== ShiftLogState.REOPENED) {
      if (log.ruleset_version != null) {
        evaluationVersion = log.ruleset_version;
        if (evaluationVersion !== currentVersion) {
          versionSkew = true;
        }
      }
    }
    
    // We compute the EffectiveRuleset by treating configured rules as the highest authority.
    const effectiveRuleset = computeEffectiveRuleset(configuredRules, evaluationVersion);

    const result = validateShiftLogSubmission(shiftLogPayload, entries, effectiveRuleset);
    
    // Annotate with version skew flag
    if (versionSkew) {
      (result as any).versionSkew = true;
    }
    
    return result;
  }

  static async assertValid(
    shiftLogId: string,
    context?: ValidationGateContext
  ): Promise<ValidationResult> {
    if (!isValidationStrict()) {
      return { isValid: true, errors: [], warnings: [] };
    }

    const result = await this.validate(shiftLogId);

    if (result.isValid) {
      return result;
    }

    const overrides = context?.overrides ?? [];
    const userRoles = (context?.user?.roles ?? []) as UserRole[];

    if (overrides.length > 0 && canOverride(result, overrides, userRoles)) {
      if (context?.user) {
        await persistOverrides(shiftLogId, overrides, context.user);
      }
      return result;
    }

    throw new ShiftLogValidationGateError(result);
  }
}
