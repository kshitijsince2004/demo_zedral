export type ValidationSeverity = 'BLOCK' | 'WARN';

export interface ValidationError {
  field: string;
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationWarning {
  field: string;
  message: string;
  ruleId: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
