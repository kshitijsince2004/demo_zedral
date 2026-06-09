import { z } from 'zod';
import { ProcessSchemas } from './fieldRules';
import { ValidationResult, ValidationError, ValidationWarning } from '../types';

import { evaluateRules } from './configurableRuleEvaluator';
import { EffectiveRuleset } from '../types/configurableRules';

export const validateProcessEntry = (
  processType: string,
  data: any,
  effectiveRuleset?: EffectiveRuleset
): ValidationResult => {
  const schema = ProcessSchemas[processType];
  
  if (!schema) {
    return {
      isValid: false,
      errors: [
        {
          field: 'processType',
          message: `Unknown process type: ${processType}`,
          severity: 'BLOCK',
        }
      ],
      warnings: [],
    };
  }

  const result = schema.safeParse(data);
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  let isValid = true;

  if (!result.success) {
    isValid = false;
    // Map Zod errors
    errors.push(...result.error.errors.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
      severity: 'BLOCK' as const,
    })));
  }

  // Apply Configurable Rules if provided
  if (effectiveRuleset) {
    const configResult = evaluateRules({ [processType]: data }, effectiveRuleset);
    if (!configResult.isValid) {
      isValid = false;
    }
    errors.push(...configResult.errors);
    warnings.push(...configResult.warnings);
  }

  return {
    isValid,
    errors,
    warnings,
  };
};
