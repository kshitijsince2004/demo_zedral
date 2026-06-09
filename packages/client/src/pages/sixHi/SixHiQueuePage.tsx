import { Navigate, useLocation } from 'react-router-dom';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { normalizeMillTab } from '../../lib/millConfig';

/** Legacy rolling/skinpass paths → unified hub with tab. */
export function SixHiQueuePage() {
  const location = useLocation();
  const { basePath, machineCode: machine } = useWorkspaceBase();
  const requested = location.pathname.includes('skinpass') ? 'skinpass' : 'rolling';
  const tab = normalizeMillTab(machine, requested);
  return <Navigate to={`${basePath}?tab=${tab}`} replace />;
}
