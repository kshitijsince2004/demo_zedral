import { Navigate } from 'react-router-dom';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZOperatorCard } from '../../components/ui/operator/ZOperatorCard';
import { PpcRollingImportPanel } from '../../components/admin/PpcRollingImportPanel';
import { useAuthStore } from '../../lib/authStore';

/** Line-scoped MH import — HRS / PKL / RWD fail-safe (journey-aware dedup). */
export function LineMhImportPage({
  line,
  title,
  subtitle,
  lockedSheetType,
}: {
  line: 'HRS' | 'PKL' | 'RWD' | 'ANN';
  title: string;
  subtitle: string;
  lockedSheetType: 'ROLLING' | 'REWINDING' | 'ANNEALING' | 'PICKLING';
}) {
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const role = useAuthStore((s) => s.role);
  const allowed =
    role === 'ADMIN'
    || role === 'SUPERVISOR'
    || (Array.isArray(lineAccess) && lineAccess.map((l) => l.toUpperCase()).includes(line));

  if (!allowed) {
    return <Navigate to="/live" replace />;
  }

  return (
    <MachineHeadShell title={title} subtitle={subtitle}>
      <ZOperatorCard title={`PPC ${line} Plan (XLSX)`} noPadding>
        <PpcRollingImportPanel lockedSheetType={lockedSheetType} line={line} />
      </ZOperatorCard>
    </MachineHeadShell>
  );
}

export function HrsMhImportPage() {
  return (
    <LineMhImportPage
      line="HRS"
      title="Import"
      subtitle="Fail-safe import into the HRS queue — skips coils already advanced past HRS"
      lockedSheetType="ROLLING"
    />
  );
}

export function PklMhImportPage() {
  return (
    <LineMhImportPage
      line="PKL"
      title="Import"
      subtitle="PKL Pickling Plan / PKL Sheet — fail-safe import; skips coils already advanced past PKL"
      lockedSheetType="PICKLING"
    />
  );
}

export function RwdMhImportPage() {
  return (
    <LineMhImportPage
      line="RWD"
      title="Import"
      subtitle="Fail-safe import into the RWD queue — skips coils already advanced past RWD"
      lockedSheetType="REWINDING"
    />
  );
}
