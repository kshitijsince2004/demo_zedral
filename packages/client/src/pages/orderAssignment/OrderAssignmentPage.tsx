import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { OrderAssignmentPanel } from './OrderAssignmentPanel';

export function OrderAssignmentPage() {
  return (
    <MachineHeadShell
      title="Order Assignment"
      subtitle="Assign and transfer orders between CRM mills"
    >
      <OrderAssignmentPanel />
    </MachineHeadShell>
  );
}
