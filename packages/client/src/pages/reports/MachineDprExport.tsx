import { useMemo, useState } from 'react';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { DprExportPanel } from '../../components/export/DprExportPanel';
import { ShiftSummaryExportPanel } from '../../components/export/ShiftSummaryExportPanel';
import { useOperationalMachineAccess } from '../../lib/useOperationalMachineAccess';
import { isAnnMhDesk, useMhDeskFocus } from '../../lib/annMhDesk';

type ExportTab = 'dpr' | 'shift-summary';

export function MachineDprExport() {
  const machineAccess = useOperationalMachineAccess();
  const focus = useMhDeskFocus((s) => s.focus);
  const annDesk = isAnnMhDesk(machineAccess, focus);
  const scopedMachines = annDesk ? ['ANN'] : machineAccess;
  const [tab, setTab] = useState<ExportTab>('dpr');

  const scopeHint = useMemo(() => {
    if (scopedMachines.length === 0) {
      return 'No machines assigned — contact admin to assign machine access before exporting.';
    }
    return annDesk
      ? 'Scoped to ANN only.'
      : `Scoped to assigned machines: ${scopedMachines.join(', ')}. Other areas export as zero.`;
  }, [annDesk, scopedMachines]);

  return (
    <MachineHeadShell
      title="Export"
      subtitle={annDesk ? 'ANN DPR and shift summary' : 'DPR and shift summary exports for your assigned machines'}
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
            title={annDesk ? 'ANN DPR export' : 'Machine DPR export'}
            subtitle={annDesk
              ? 'Export Annealing DPR for the current desk.'
              : 'Export machine-specific DPR reports and performance summaries for assigned machines.'}
            scopeHint={scopeHint}
            historyPath="/machine-head/exports/history"
          />
        ) : (
          <ShiftSummaryExportPanel
            title={annDesk ? 'ANN Shift Summary' : 'Machine Shift Summary export'}
            subtitle={annDesk
              ? 'Export ANN shift production report.'
              : 'Export shift production report for your assigned machines.'}
            scopeHint={scopeHint}
            historyPath="/machine-head/exports/history"
            machineCodes={scopedMachines}
          />
        )}
      </div>
    </MachineHeadShell>
  );
}
