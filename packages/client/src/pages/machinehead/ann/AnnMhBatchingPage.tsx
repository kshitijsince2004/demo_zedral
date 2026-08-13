import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { AnnBatchingWorkspace } from '../../../components/process/AnnBatchingWorkspace';

/** MH Ann Batching — shell + shared charge-builder workspace. */
export function AnnMhBatchingPage() {
  return (
    <MachineHeadShell
      title="Ann Batching"
      subtitle="Stack orders bottom→top, assign batch + base, create charge"
      fillViewport
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AnnBatchingWorkspace />
      </div>
    </MachineHeadShell>
  );
}
