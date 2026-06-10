export interface FieldSourceOption {
  type: 'db_table' | 'api_route' | 'service_export';
  name: string;
  confidence: number; // 0 to 1
  metadata?: any;
}

export interface SourceMapEntry {
  fieldId: string;
  status: 'auto-sourced' | 'needs-confirmation' | 'manual' | 'confirmed';
  options: FieldSourceOption[];
  selectedOption?: FieldSourceOption;
  machineIdentifier?: string;
  unit?: string;
  grain?: string;
}

export interface ClarifyingQuestion {
  questionId: string;
  fieldId: string;
  prompt: string;
  options: string[];
}
