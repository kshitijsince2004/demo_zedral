import { Navigate } from 'react-router-dom';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZOperatorCard } from '../../components/ui/operator/ZOperatorCard';
import { PpcRollingImportPanel } from '../../components/admin/PpcRollingImportPanel';
import { useAuthStore } from '../../lib/authStore';
import type { PpcXlsxSheetType } from '../../services/adminService';

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

export function CrmMillImportPage({ mill }: { mill: '6HI' | '4HI' | '2HI' }) {
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const role = useAuthStore((s) => s.role);
  const allowed =
    role === 'ADMIN'
    || role === 'SUPERVISOR'
    || (machineAccess ?? []).map((m) => m.toUpperCase()).includes(mill);
  if (!allowed) return <Navigate to="/live" replace />;
  const sheets: PpcXlsxSheetType[] = mill === '2HI' ? ['SKIN_PASS', 'REWINDING'] : ['ROLLING', 'SKIN_PASS'];
  const subtitle = mill === '2HI'
    ? '2HI plan file — Skin Pass + Rewinding stay in this mill desk'
    : `${mill} plan file — Rolling / Skin Pass stay in this mill desk`;
  return (
    <MachineHeadShell title="Import" subtitle={subtitle}>
      <ZOperatorCard title={`PPC ${mill} Plan (XLSX)`} noPadding>
        <PpcRollingImportPanel allowedSheetTypes={sheets} />
      </ZOperatorCard>
    </MachineHeadShell>
  );
}

export function SixHiMhImportPage() {
  return <CrmMillImportPage mill="6HI" />;
}
export function FourHiMhImportPage() {
  return <CrmMillImportPage mill="4HI" />;
}
export function TwoHiMhImportPage() {
  return <CrmMillImportPage mill="2HI" />;
}
