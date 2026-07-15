import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { ApiError } from '../lib/apiClient';
import { machineHandoverService, type PendingHandover } from '../services/machineHandoverService';
import { HandoverAcceptPage } from '../pages/sixHi/HandoverAcceptPage';
import { ZButton } from './primitives/ZButton';

interface HandoverAcceptGateProps {
  machineCode: string;
  children: React.ReactNode;
}

/** Blocks CRM workspace until incoming operator accepts pending handover. */
export function HandoverAcceptGate({ machineCode, children }: HandoverAcceptGateProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const [pending, setPending] = useState<PendingHandover | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const machineAccess = useAuthStore((s) => s.machineAccess);

  // Outgoing operators use /handover to submit — never block that route behind the accept gate.
  const onOutgoingHandoverRoute = /\/handover\/?$/.test(location.pathname);

  const checkPending = useCallback(async () => {
    setLoadError(null);
    // Don't reset pending→undefined on refresh — that flashes a z-200 overlay and blocks Logout.
    try {
      if (!machineAccess.includes(machineCode)) {
        setPending(null);
        return;
      }
      const { pending: p } = await Promise.race([
        machineHandoverService.getPending(machineCode),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('Handover check timed out')), 15_000);
        }),
      ]);
      setPending(p);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login', { replace: true });
        return;
      }
      setLoadError(err instanceof Error ? err.message : 'Failed to check handover status');
      setPending((prev) => (prev === undefined ? null : prev));
    }
  }, [machineCode, machineAccess, logout, navigate]);

  useEffect(() => {
    void checkPending();
  }, [checkPending]);

  if (onOutgoingHandoverRoute) {
    return <>{children}</>;
  }

  // Instead of returning early and unmounting everything,
  // we render the gate as a full-screen overlay if needed.
  return (
    <>
      {children}

      {(pending === undefined && !loadError) && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-secondary/80 backdrop-blur-sm text-muted-foreground text-sm">
          <div className="flex flex-col items-center gap-2">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Checking handover status…
          </div>
        </div>
      )}

      {loadError && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-secondary gap-4 p-6">
          <p className="text-sm text-destructive text-center max-w-md">{loadError}</p>
          <div className="flex gap-3">
            <ZButton variant="secondary" onClick={() => void checkPending()}>
              Retry
            </ZButton>
            <ZButton variant="danger" onClick={() => logout()}>
              Logout
            </ZButton>
          </div>
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-[200]">
          <HandoverAcceptPage
            handover={pending}
            onAccepted={() => setPending(null)}
          />
        </div>
      )}
    </>
  );
}
