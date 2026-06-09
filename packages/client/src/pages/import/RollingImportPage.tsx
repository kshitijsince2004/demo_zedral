import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ExecutiveShell } from '../../components/layout/executive/ExecutiveShell';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { PpcRollingImportPanel } from '../../components/admin/PpcRollingImportPanel';
import { useAuthStore } from '../../lib/authStore';

export function RollingImportPage() {
  const role = useAuthStore((s) => s.role);
  const Shell = role === 'PLANT_HEAD' || role === 'ADMIN' ? ExecutiveShell : MachineHeadShell;

  return (
    <Shell title="PPC Plan Import" subtitle="Import rolling, skin pass, or rewinding sheets from the PPC workbook">
      <AdminPanel title="PPC Rolling Plan (XLSX)">
        <PpcRollingImportPanel />
      </AdminPanel>
    </Shell>
  );
}
