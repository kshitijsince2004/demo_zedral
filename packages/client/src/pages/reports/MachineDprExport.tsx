import { useMemo, useState } from 'react';
import { useAuthStore } from '../../lib/authStore';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { DprExportPanel } from '../../components/export/DprExportPanel';
import { ShiftSummaryExportPanel } from '../../components/export/ShiftSummaryExportPanel';

type ExportTab = 'dpr' | 'shift-summary';

export function MachineDprExport() {
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const [tab, setTab] = useState<ExportTab>('dpr');

  const scopeHint = useMemo(() => {
    if (machineAccess.length === 0) {
      return 'No machines assigned — contact admin to assign machine access before exporting.';
    }
    return `Scoped to assigned machines: ${machineAccess.join(', ')}. Other areas export as zero.`;
  }, [machineAccess]);

  return (
    <MachineHeadShell
      title="Export"
      subtitle="DPR and shift summary exports for your assigned machines"
    >
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
            title="Machine DPR export"
            subtitle="Export machine-specific DPR reports and performance summaries for assigned machines."
            scopeHint={scopeHint}
            historyPath="/machine-head/exports/history"
          />
        ) : (
          <ShiftSummaryExportPanel
            title="Machine Shift Summary export"
            subtitle="Export shift production report for your assigned machines."
            scopeHint={scopeHint}
            historyPath="/machine-head/exports/history"
            machineCodes={machineAccess}
          />
        )}
      </div>
    </MachineHeadShell>
  );
}
