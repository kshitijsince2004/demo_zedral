import { AdminShell } from '../../components/layout/admin/AdminShell';




import { AdminPanel } from '../../components/admin/AdminPanel';
import { PpcRollingImportPanel } from '../../components/admin/PpcRollingImportPanel';
import { useAuthStore } from '../../lib/authStore';

export function RollingImportPage() {
  const role = useAuthStore((s) => s.role);
  const Shell = role === 'PLANT_HEAD' || role === 'ADMIN' ? AdminShell : AdminShell;

  return (
    <Shell title="PPC Plan Import" subtitle="Import rolling, skin pass, or rewinding sheets from the PPC workbook">
      <AdminPanel title="PPC Rolling Plan (XLSX)">
        <PpcRollingImportPanel />
      </AdminPanel>
    </Shell>
  );
}
