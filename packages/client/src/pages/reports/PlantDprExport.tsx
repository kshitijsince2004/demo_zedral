import { useState } from 'react';
import { DprExportPanel } from '../../components/export/DprExportPanel';
import { ShiftSummaryExportPanel } from '../../components/export/ShiftSummaryExportPanel';

type ExportTab = 'dpr' | 'shift-summary';

export function PlantDprExport() {
  const [tab, setTab] = useState<ExportTab>('dpr');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('dpr')}
          className={[
            'px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors',
            tab === 'dpr' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
          ].join(' ')}
        >
          DPR
        </button>
        <button
          type="button"
          onClick={() => setTab('shift-summary')}
          className={[
            'px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors',
            tab === 'shift-summary' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
          ].join(' ')}
        >
          Shift Summary
        </button>
      </div>

      {tab === 'dpr' ? (
        <DprExportPanel
          title="Plant DPR export"
          subtitle="Export plant-wide daily production reports for all authorized production lines and machines."
          scopeHint="Includes all plant areas. Report follows the official DPR Excel template with formulas and formatting preserved."
          historyPath="/plant/exports/history"
        />
      ) : (
        <ShiftSummaryExportPanel
          title="Plant Shift Summary export"
          subtitle="Export shift production figures, completed orders, held orders, and stoppages for a chosen date and shift."
          scopeHint="Includes all plant machines unless a specific machine is selected."
          historyPath="/plant/exports/history"
        />
      )}
    </div>
  );
}
