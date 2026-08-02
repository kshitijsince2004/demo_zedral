import { useOutletContext } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { classifyHandoverBranch } from '../lib/classifyHandoverBranch';
import { CrmOutgoingHandoverPage } from '../pages/sixHi/CrmOutgoingHandoverPage';
import { ProcessHandoverPage } from '../pages/process/ProcessHandoverPage';
import { AnnOutgoingHandoverPage } from '../pages/process/AnnOutgoingHandoverPage';
import { HrsOutgoingHandoverPage } from '../pages/process/HrsOutgoingHandoverPage';
import { PklOutgoingHandoverPage } from '../pages/process/PklOutgoingHandoverPage';
import { RwdOutgoingHandoverPage } from '../pages/process/RwdOutgoingHandoverPage';

export function ScopeHandoverRoute() {
  const activeMachine = useAuthStore((s) => s.activeMachine);
  const outlet = useOutletContext<{ processCode?: string } | null>();
  const processCode = outlet?.processCode ?? null;
  const branch = classifyHandoverBranch(activeMachine, processCode);

  if (branch === 'ann') return <AnnOutgoingHandoverPage />;
  if (branch === 'pkl') return <PklOutgoingHandoverPage />;
  if (branch === 'hrs') return <HrsOutgoingHandoverPage />;
  if (branch === 'rwd') return <RwdOutgoingHandoverPage />;
  if (branch === 'crm') return <CrmOutgoingHandoverPage />;
  return <ProcessHandoverPage />;
}
