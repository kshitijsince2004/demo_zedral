import { useMemo } from 'react';
import { useAuthStore } from '../../lib/authStore';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { DprExportPanel } from '../../components/export/DprExportPanel';

export function MachineDprExport() {
  const machineAccess = useAuthStore((s) => s.machineAccess);

  const scopeHint = useMemo(() => {
    if (machineAccess.length === 0) {
      return 'No machines assigned — contact admin to assign machine access before exporting.';
    }
    return `Scoped to assigned machines: ${machineAccess.join(', ')}. Other areas export as zero.`;
  }, [machineAccess]);

  return (
    <MachineHeadShell
      title="Machine DPR export"
      subtitle="Export DPR for your assigned machines only"
    >
      <DprExportPanel
        title="Machine DPR export"
        subtitle="Export machine-specific DPR reports and performance summaries for assigned machines."
        scopeHint={scopeHint}
        historyPath="/machine-head/exports/history"
      />
    </MachineHeadShell>
  );
}
