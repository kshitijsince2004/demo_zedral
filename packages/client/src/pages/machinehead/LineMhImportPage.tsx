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
  lockedSheetType: 'ROLLING' | 'REWINDING' | 'ANNEALING' | 'PICKLING' | 'HRS' | 'PKL';
}) {
  const lineAccess = useAuthStore((s) => s.lineAccess);
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const role = useAuthStore((s) => s.role);
  const machines = (machineAccess ?? []).map((m) => m.toUpperCase());
  const allowed =
    role === 'ADMIN'
    || role === 'SUPERVISOR'
    || (Array.isArray(lineAccess) && lineAccess.map((l) => l.toUpperCase()).includes(line))
    || (line === 'RWD' && (machines.includes('RWD') || machines.includes('2HI')));

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
      subtitle="HRS plan file only — fail-safe import; skips coils already advanced past HRS"
      lockedSheetType="HRS"
    />
  );
}

export function PklMhImportPage() {
  return (
    <LineMhImportPage
      line="PKL"
      title="Import"
      subtitle="PKL plan file only — fail-safe import; skips coils already advanced past PKL"
      lockedSheetType="PKL"
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

/** One Rolling / Skin Pass import for 2HI + 4HI + 6HI (process-wise, not mill-wise). */
export function RollingSkinMhImportPage() {
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const role = useAuthStore((s) => s.role);
  const mills = (machineAccess ?? []).map((m) => m.toUpperCase());
  const allowed =
    role === 'ADMIN'
    || role === 'SUPERVISOR'
    || mills.some((m) => m === '6HI' || m === '4HI' || m === '2HI');
  if (!allowed) return <Navigate to="/live" replace />;
  return (
    <MachineHeadShell
      title="Import"
      subtitle="Rolling / Skin Pass plan — one import for 2HI, 4HI, and 6HI"
    >
      <ZOperatorCard title="PPC Rolling / Skin Pass Plan (XLSX)" noPadding>
        <PpcRollingImportPanel allowedSheetTypes={['ROLLING', 'SKIN_PASS']} />
      </ZOperatorCard>
    </MachineHeadShell>
  );
}

