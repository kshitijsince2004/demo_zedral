import type { ValidationSeverity } from './validation';

export type RuleType = 'RANGE' | 'ALLOWED_VALUES' | 'STEP' | 'PATTERN' | 'MANDATORY' | 'MIN_PCT_OF_FIELD' | 'MAX_PCT_OF_FIELD' | 'COMPARE_FIELD' | 'CONDITIONAL';
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

export interface PctOfFieldParams {
  ofField: string;
  pct: number;
}

export interface CompareFieldParams {
  op: '<' | '<=' | '>' | '>=';
  field: string;
}

export interface ConditionalParams {
  // Can contain nested rule params
}

export type RuleParams =
  | { type: 'RANGE'; params: RangeParams }
  | { type: 'ALLOWED_VALUES'; params: AllowedValuesParams }
  | { type: 'STEP'; params: StepParams }
  | { type: 'PATTERN'; params: PatternParams }
  | { type: 'MANDATORY'; params: MandatoryParams }
  | { type: 'MIN_PCT_OF_FIELD'; params: PctOfFieldParams }
  | { type: 'MAX_PCT_OF_FIELD'; params: PctOfFieldParams }
  | { type: 'COMPARE_FIELD'; params: CompareFieldParams }
  | { type: 'CONDITIONAL'; params: ConditionalParams };

export type ValidationRule = {
  ruleId?: string;
  fieldId: string;
  severity: ValidationSeverity;
  origin: RuleOrigin;
  isActive: boolean;
  version?: number;
  processCode?: string;
  machineCode?: string;
  appliesWhen?: Record<string, unknown>;
} & RuleParams;

export interface EffectiveRuleset {
  rules: Record<string, ValidationRule[]>;
  version: number;
}
