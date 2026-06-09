import type { ValidationSeverity } from './validation';

export type RuleType = 'RANGE' | 'ALLOWED_VALUES' | 'STEP' | 'PATTERN' | 'MANDATORY';
export type RuleOrigin = 'DEFAULT' | 'CONFIGURER';

export interface RangeParams {
  min?: number;
  max?: number;
}

export interface AllowedValuesParams {
  values: string[];
}

export interface StepParams {
  step: number;
}

export interface PatternParams {
  pattern: string;
}

export interface MandatoryParams {
  mandatory: boolean;
}

export type RuleParams =
  | { type: 'RANGE'; params: RangeParams }
  | { type: 'ALLOWED_VALUES'; params: AllowedValuesParams }
  | { type: 'STEP'; params: StepParams }
  | { type: 'PATTERN'; params: PatternParams }
  | { type: 'MANDATORY'; params: MandatoryParams };

export type ValidationRule = {
  id?: string;
  fieldId: string;
  severity: ValidationSeverity;
  origin: RuleOrigin;
  isActive: boolean;
  version?: number;
} & RuleParams;

export interface EffectiveRuleset {
  rules: Record<string, ValidationRule[]>;
  version: number;
}
