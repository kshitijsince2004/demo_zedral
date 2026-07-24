import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../../../lib/authStore';
import { isCrmMillPath } from '../../../lib/millConfig';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { OperatorNavRail } from './OperatorNavRail';
import { StatusRail } from './StatusRail';
import { LogoutConfirmModal } from '../../ui/LogoutConfirmModal';
import { useSixHiStore } from '../../../store/sixHiStore';

interface OperatorShellProps {
  processCode?: string;
  children: React.ReactNode;
  /** When true, skip the status header (e.g. nested inside SixHiLayout). */
  bare?: boolean;
  onManualStoppage?: () => void;
  onShiftReadings?: () => void;
}

export function OperatorShell({
  processCode = 'HRS',
  children,
  bare = false,
  onManualStoppage,
  onShiftReadings,
}: OperatorShellProps) {
  const logout = useAuthStore((s) => s.logout);
  const [logoutOpen, setLogoutOpen] = React.useState(false);
  const location = useLocation();
  const isCrmMill = isCrmMillPath(location.pathname);
  const workspaceOpen = useSixHiStore((s) => s.workspaceOpen);

  const navOffset = isCrmMill ? 'ml-16' : 'ml-14';
  const showStatusRail = !bare && !(isCrmMill && workspaceOpen);

  React.useEffect(() => {
    console.info(`[OperatorShell] Operator Screen initialized`, { processCode });
  }, [processCode]);

  return (
    <div className="theme-operator h-screen overflow-hidden bg-background text-foreground">
      <OperatorNavRail processCode={processCode} onLogout={() => setLogoutOpen(true)} />
      <div className={`flex flex-col min-w-0 h-full overflow-hidden ${navOffset}`}>
        {showStatusRail && (
          <StatusRail
            processCode={processCode}
            onManualStoppage={onManualStoppage}
            onShiftReadings={onShiftReadings}
          />
        )}
        <OfflineBanner />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</main>
      </div>

      <LogoutConfirmModal
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={logout}
      />
    </div>
  );
}
