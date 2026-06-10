import { AdminShell } from '../../components/layout/admin/AdminShell';
import { DprExportPanel } from '../../components/export/DprExportPanel';

export function DprExport() {
  return (
    <AdminShell title="DPR export" subtitle="Monthly production report · template-driven auto-generation">
      <DprExportPanel historyPath="/reports/exports/history" />
    </AdminShell>
  );
}
