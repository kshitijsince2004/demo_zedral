import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZOperatorCard } from '../../../components/ui/operator/ZOperatorCard';
import { PpcRollingImportPanel } from '../../../components/admin/PpcRollingImportPanel';

/** ANN MH Import — Annealing PPC sheet only. */
export function AnnMhImportPage() {
  return (
    <MachineHeadShell
      title="Import"
      subtitle="Import Annealing sheet from the PPC workbook into the ANN queue"
    >
      <ZOperatorCard title="PPC Annealing Plan (XLSX)" noPadding>
        <PpcRollingImportPanel lockedSheetType="ANNEALING" />
      </ZOperatorCard>
    </MachineHeadShell>
  );
}
