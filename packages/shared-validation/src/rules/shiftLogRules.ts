import { z } from 'zod';
import { ShiftLogState } from '../types';
import { validateProcessEntry } from './runner';
import { ValidationResult, ValidationError, ValidationWarning } from '../types';
import { EffectiveRuleset } from '../types/configurableRules';
import { evaluateRules } from './configurableRuleEvaluator';

export const ShiftLogSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  processLine: z.string().min(1, 'Process line is required'),
  productionDate: z.date(),
  shiftCode: z.enum(['A', 'B', 'C', 'G']),
  millType: z.string().optional(),
  state: z.nativeEnum(ShiftLogState),
  supervisorId: z.string().min(1, 'Supervisor ID is required'),
  targetMt: z.number().positive().optional(),
  lineInchargeId: z.string().optional(),
  shiftManagerId: z.string().optional(),
  approverId: z.string().optional(),
  submittedAt: z.date().optional(),
  approvedAt: z.date().optional(),
}).superRefine((data, ctx) => {
  if (data.processLine === 'CRM' && !data.millType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'mill_type is required for CRM process line',
      path: ['millType'],
    });
  }
  if (data.processLine === 'CRM' && data.millType && !['2HI', '4HI', '6HI'].includes(data.millType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'mill_type must be one of 2HI, 4HI, 6HI',
      path: ['millType'],
    });
  }
});

export const validateShiftLogSubmission = (
  shiftLog: any,
  entries: any[],
  effectiveRuleset?: EffectiveRuleset
): ValidationResult => {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  // Validate shift log root metadata
  const slValidation = ShiftLogSchema.safeParse(shiftLog);
  if (!slValidation.success) {
    result.isValid = false;
    const errors = slValidation.error.errors.map(err => ({
      field: `shiftLog.${err.path.join('.')}`,
      message: err.message,
      severity: 'BLOCK' as const,
    }));
    result.errors.push(...errors);
  }

  // Validate each entry based on the process line
  const processType = shiftLog.processLine;
  if (processType) {
    entries.forEach((entry, idx) => {
      const entryResult = validateProcessEntry(processType, entry);
      if (!entryResult.isValid) {
        result.isValid = false;
        // Prefix fields with index for array-like behavior
        const mappedErrors = entryResult.errors.map(err => ({
          ...err,
          field: `entries[${idx}].${err.field}`,
        }));
        result.errors.push(...mappedErrors);
      }
      
      const mappedWarnings = entryResult.warnings.map(warn => ({
        ...warn,
        field: `entries[${idx}].${warn.field}`,
      }));
      result.warnings.push(...mappedWarnings);

      // Evaluate Configurable Rules for this entry if a ruleset is provided
      if (effectiveRuleset) {
        const configResult = evaluateRules({ [processType]: entry }, effectiveRuleset);
        if (!configResult.isValid) {
          result.isValid = false;
          const mappedConfigErrors = configResult.errors.map(err => ({
            ...err,
            field: `entries[${idx}].${err.field}`,
          }));
          result.errors.push(...mappedConfigErrors);
        }
        const mappedConfigWarnings = configResult.warnings.map(warn => ({
          ...warn,
          field: `entries[${idx}].${warn.field}`,
        }));
        result.warnings.push(...mappedConfigWarnings);
      }
    });
  }

  // Evaluate Configurable Rules for shift log root metadata
  if (effectiveRuleset) {
    const rootConfigResult = evaluateRules({ SHIFT_LOG: shiftLog }, effectiveRuleset);
    if (!rootConfigResult.isValid) {
      result.isValid = false;
      const mappedConfigErrors = rootConfigResult.errors.map(err => ({
        ...err,
        field: `shiftLog.${err.field}`,
      }));
      result.errors.push(...mappedConfigErrors);
    }
    const mappedConfigWarnings = rootConfigResult.warnings.map(warn => ({
      ...warn,
      field: `shiftLog.${warn.field}`,
    }));
    result.warnings.push(...mappedConfigWarnings);
  }

  return result;
};
