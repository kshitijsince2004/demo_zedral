import { ValidationRule, RuleParams, EffectiveRuleset } from '../types/configurableRules';
import { ValidationError, ValidationResult } from '../types/validation';
import { getFieldDescriptor } from './fieldRegistry';

export function validateRuleDefinition(rule: ValidationRule): string | null {
  if (rule.severity !== 'BLOCK' && rule.severity !== 'WARN') {
    return 'severity';
  }

  switch (rule.type) {
    case 'RANGE':
      if (rule.params.min === undefined && rule.params.max === undefined) {
        return 'params';
      }
      if (
        rule.params.min !== undefined &&
        rule.params.max !== undefined &&
        rule.params.min > rule.params.max
      ) {
        return 'params.min';
      }
      break;

    case 'ALLOWED_VALUES':
      if (!rule.params.values || rule.params.values.length === 0) {
        return 'params.values';
      }
      break;

    case 'STEP':
      if (rule.params.step === undefined || rule.params.step <= 0) {
        return 'params.step';
      }
      break;

    case 'PATTERN':
      if (!rule.params.pattern) {
        return 'params.pattern';
      }
      try {
        new RegExp(rule.params.pattern);
      } catch {
        return 'params.pattern';
      }
      break;

    case 'MANDATORY':
      if (rule.params.mandatory === undefined) {
        return 'params.mandatory';
      }
      break;

    default:
      return 'type';
  }

  return null;
}

export function computeEffectiveRuleset(
  allRules: ValidationRule[],
  version: number
): EffectiveRuleset {
  const effective: Record<string, ValidationRule[]> = {};

  // Group by fieldId -> ruleType
  const grouped = new Map<string, Map<string, ValidationRule[]>>();

  for (const rule of allRules) {
    if (!grouped.has(rule.fieldId)) {
      grouped.set(rule.fieldId, new Map());
    }
    const fieldMap = grouped.get(rule.fieldId)!;
    if (!fieldMap.has(rule.type)) {
      fieldMap.set(rule.type, []);
    }
    fieldMap.get(rule.type)!.push(rule);
  }

  for (const [fieldId, fieldMap] of grouped.entries()) {
    effective[fieldId] = [];
    for (const rulesOfType of fieldMap.values()) {
      let selected: ValidationRule | undefined = undefined;

      const configurerRule = rulesOfType.find((r) => r.origin === 'CONFIGURER');
      const defaultRule = rulesOfType.find((r) => r.origin === 'DEFAULT');

      if (configurerRule && configurerRule.isActive) {
        selected = configurerRule;
      } else if (defaultRule && defaultRule.isActive) {
        selected = defaultRule;
      }

      if (selected) {
        effective[fieldId].push(selected);
      }
    }
  }

  return {
    rules: effective,
    version,
  };
}

export function evaluateField(value: any, rules: ValidationRule[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const rule of rules) {
    if (!rule.isActive) continue;

    let isBreach = false;
    let message = '';

    // Empty values are generally ignored by rules other than MANDATORY
    const isEmpty = value === undefined || value === null || value === '';

    switch (rule.type) {
      case 'MANDATORY':
        if (rule.params.mandatory && isEmpty) {
          isBreach = true;
          message = 'This field is mandatory.';
        }
        break;

      case 'RANGE':
        if (!isEmpty && typeof value === 'number') {
          const min = rule.params.min;
          const max = rule.params.max;
          if (min !== undefined && value < min) {
            isBreach = true;
            message = `Value must be at least ${min}.`;
          }
          if (max !== undefined && value > max) {
            isBreach = true;
            message = `Value must be at most ${max}.`;
          }
        }
        break;

      case 'ALLOWED_VALUES':
        if (!isEmpty && typeof value === 'string') {
          if (!rule.params.values.includes(value)) {
            isBreach = true;
            message = `Value must be one of: ${rule.params.values.join(', ')}.`;
          }
        }
        break;

      case 'STEP':
        if (!isEmpty && typeof value === 'number') {
          const step = rule.params.step;
          // Use a small epsilon to avoid floating point issues
          const remainder = value % step;
          if (remainder > 1e-9 && (step - remainder) > 1e-9) {
            isBreach = true;
            message = `Value must be a multiple of ${step}.`;
          }
        }
        break;

      case 'PATTERN':
        if (!isEmpty && typeof value === 'string') {
          const regex = new RegExp(rule.params.pattern);
          if (!regex.test(value)) {
            isBreach = true;
            message = `Value does not match the required format.`;
          }
        }
        break;
    }

    if (isBreach) {
      errors.push({
        field: rule.fieldId,
        message,
        severity: rule.severity,
      });
    }
  }

  return errors;
}

export function evaluateRules(
  data: Record<string, any>,
  effectiveRuleset: EffectiveRuleset
): ValidationResult {
  const allErrors: ValidationError[] = [];

  for (const [fieldId, rules] of Object.entries(effectiveRuleset.rules)) {
    // For simplicity, support simple flat paths like "PKL.lineSpeedMpm" mapping to { PKL: { lineSpeedMpm: 123 } }
    const parts = fieldId.split('.');
    let value: any = data;
    for (const part of parts) {
      if (value) {
        value = value[part];
      } else {
        value = undefined;
        break;
      }
    }

    const fieldErrors = evaluateField(value, rules);
    allErrors.push(...fieldErrors);
  }

  const hasBlock = allErrors.some((e) => e.severity === 'BLOCK');
  const warnings = allErrors
    .filter((e) => e.severity === 'WARN')
    .map((w) => ({ field: w.field, message: w.message, ruleId: w.field }));

  return {
    isValid: !hasBlock,
    errors: allErrors.filter((e) => e.severity === 'BLOCK'),
    warnings,
  };
}

export function describeBreach(rule: ValidationRule): string {
  let condition = '';

  switch (rule.type) {
    case 'MANDATORY':
      condition = 'must be provided';
      break;
    case 'RANGE':
      const min = rule.params.min;
      const max = rule.params.max;
      if (min !== undefined && max !== undefined) {
        condition = `must be between ${min} and ${max}`;
      } else if (min !== undefined) {
        condition = `must be at least ${min}`;
      } else if (max !== undefined) {
        condition = `must be at most ${max}`;
      }
      break;
    case 'ALLOWED_VALUES':
      condition = `must be one of: ${rule.params.values.join(', ')}`;
      break;
    case 'STEP':
      condition = `must be a multiple of ${rule.params.step}`;
      break;
    case 'PATTERN':
      condition = `must match the required format`;
      break;
  }

  if (rule.severity === 'BLOCK') {
    return `Value ${condition}. Correction is required to proceed.`;
  } else {
    return `Value ${condition}. Please provide an override reason to proceed.`;
  }
}
