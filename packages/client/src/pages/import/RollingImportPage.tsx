import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { PpcRollingImportPanel } from '../../components/admin/PpcRollingImportPanel';
import { useAuthStore } from '../../lib/authStore';

export function RollingImportPage() {
  const role = useAuthStore((s) => s.role);
  const isMachineHead = role === 'MACHINE_HEAD';
  const Shell = isMachineHead ? MachineHeadShell : AdminShell;

  return (
    <Shell
      title="PPC Plan Import"
      subtitle="Import rolling or skin pass sheets from the PPC workbook"
    >
      <AdminPanel title="PPC Rolling Plan (XLSX)">
        <PpcRollingImportPanel />
      </AdminPanel>
    </Shell>
  );
}
