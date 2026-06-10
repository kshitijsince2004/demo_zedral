import { DprExportPanel } from '../../components/export/DprExportPanel';

export function PlantDprExport() {
  return (
    <DprExportPanel
      title="Plant DPR export"
      subtitle="Export plant-wide daily production reports for all authorized production lines and machines."
      scopeHint="Includes all plant areas. Report follows the official DPR Excel template with formulas and formatting preserved."
      historyPath="/plant/exports/history"
    />
  );
}
