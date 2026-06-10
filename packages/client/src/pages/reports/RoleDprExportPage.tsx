import { useAuthStore } from '../../lib/authStore';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { PlantHeadShell } from '../../components/layout/PlantHeadShell';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { DprExportPanel } from '../../components/export/DprExportPanel';
import { ExportHistory } from './ExportHistory';

function ExportHistoryInner() {
  return <ExportHistory embedded />;
}

export function RoleDprExportPage() {
  const role = useAuthStore((s) => s.role);
  const machineAccess = useAuthStore((s) => s.machineAccess);

  if (role === 'PLANT_HEAD') {
    return (
      <DprExportPanel
        title="Plant DPR export"
        subtitle="Export plant-wide daily production reports."
        scopeHint="Plant-wide scope — all authorized production lines and machines."
        historyPath="/plant/exports/history"
      />
    );
  }

  if (role === 'MACHINE_HEAD') {
    const hint = machineAccess.length
      ? `Assigned machines: ${machineAccess.join(', ')}`
      : 'No machines assigned.';
    return (
      <DprExportPanel
        title="Machine DPR export"
        subtitle="Export DPR for assigned machines only."
        scopeHint={hint}
        historyPath="/machine-head/exports/history"
      />
    );
  }

  return (
    <DprExportPanel
      historyPath="/reports/exports/history"
    />
  );
}

export function RoleDprExportHistoryPage() {
  const role = useAuthStore((s) => s.role);

  if (role === 'PLANT_HEAD') {
    return <ExportHistoryInner />;
  }

  if (role === 'MACHINE_HEAD') {
    return (
      <MachineHeadShell title="Export history" subtitle="Past DPR export jobs">
        <ExportHistoryInner />
      </MachineHeadShell>
    );
  }

  return (
    <AdminShell title="Export history" subtitle="Past export jobs">
      <ExportHistoryInner />
    </AdminShell>
  );
}
