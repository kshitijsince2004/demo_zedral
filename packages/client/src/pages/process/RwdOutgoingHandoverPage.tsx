/** RWD outgoing handover — reuses process-station handover chrome with MACHINE_CODE=RWD. */
import { HrsOutgoingHandoverPage } from './HrsOutgoingHandoverPage';

export function RwdOutgoingHandoverPage() {
  return <HrsOutgoingHandoverPage machineCode="RWD" />;
}
