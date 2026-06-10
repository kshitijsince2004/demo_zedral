import { DPR_FIELD_CATALOG, catalogSummary, type DprFieldDefinition } from './dprFieldCatalog';

export interface FieldAuditRow {
  fieldId: string;
  templateRegion: string;
  templateCols: string;
  dataSource: string;
  status: DprFieldDefinition['status'];
  confidence: DprFieldDefinition['confidence'];
  notes?: string;
}

export interface MappingAuditReport {
  generatedAt: string;
  summary: ReturnType<typeof catalogSummary>;
  fields: FieldAuditRow[];
  missingMappings: FieldAuditRow[];
  calculatedFields: FieldAuditRow[];
  manualFields: FieldAuditRow[];
}

/** Produce a field-by-field mapping verification report. */
export function buildMappingAuditReport(): MappingAuditReport {
  const fields: FieldAuditRow[] = DPR_FIELD_CATALOG.map((f) => ({
    fieldId: f.fieldId,
    templateRegion: f.templateRegion,
    templateCols: f.templateCols,
    dataSource: f.dataSource,
    status: f.status,
    confidence: f.confidence,
    notes: f.notes,
  }));

  return {
    generatedAt: new Date().toISOString(),
    summary: catalogSummary(),
    fields,
    missingMappings: fields.filter((f) => f.status === 'missing'),
    calculatedFields: fields.filter((f) => f.status === 'calculated'),
    manualFields: fields.filter((f) => f.status === 'manual'),
  };
}

/** Markdown table for documentation deliverable. */
export function mappingAuditMarkdown(): string {
  const report = buildMappingAuditReport();
  const lines = [
    '# DPR Export — Mapping Verification Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Total fields catalogued: **${report.summary.total}**`,
    `- Mapped (auto-sourced): **${report.summary.byStatus.mapped}**`,
    `- Calculated (Excel formulas): **${report.summary.byStatus.calculated}**`,
    `- Manual (default 0): **${report.summary.byStatus.manual}**`,
    `- Missing: **${report.summary.byStatus.missing}**`,
    '',
    '## Field-by-field verification',
    '',
    '| Field | Region | Cols | Source | Status | Confidence |',
    '|-------|--------|------|--------|--------|------------|',
  ];

  for (const f of report.fields) {
    lines.push(
      `| ${f.fieldId} | ${f.templateRegion} | ${f.templateCols} | ${f.dataSource} | ${f.status} | ${f.confidence} |`,
    );
  }

  if (report.manualFields.length) {
    lines.push('', '## Manual fields (export as 0 unless operator override in DPR Manager)', '');
    for (const f of report.manualFields) {
      lines.push(`- **${f.fieldId}** (${f.templateCols}): ${f.notes ?? 'no platform source'}`);
    }
  }

  return lines.join('\n');
}
