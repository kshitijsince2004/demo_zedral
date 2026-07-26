import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { ApiError } from '../lib/apiClient';
import { machineHandoverService } from '../services/machineHandoverService';
import { useHandoverPending } from '../hooks/useHandoverState';
import { HandoverAcceptPage } from '../pages/sixHi/HandoverAcceptPage';
import { ZButton } from './primitives/ZButton';

interface HandoverAcceptGateProps {
  machineCode: string;
  children: React.ReactNode;
  /** Fired after accept so parent can prompt crew for the new session (§11). */
  onHandoverAccepted?: (sessionId: string) => void;
}

/** Blocks CRM workspace until incoming operator accepts pending handover. */
export function HandoverAcceptGate({ machineCode, children, onHandoverAccepted }: HandoverAcceptGateProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const machineAccess = useAuthStore((s) => s.machineAccess);

  // Outgoing operators use /handover to submit — never block that route behind the accept gate.
  const onOutgoingHandoverRoute = /\/handover\/?$/.test(location.pathname);

  const allowed = machineAccess.map((m) => m.toUpperCase()).includes(machineCode.toUpperCase());
  const {
    data: pending,
    error,
    isLoading,
    mutate,
  } = useHandoverPending(machineCode, allowed && !onOutgoingHandoverRoute);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      logout();
      navigate('/login', { replace: true });
    }
  }, [error, logout, navigate]);

  if (onOutgoingHandoverRoute) {
    return <>{children}</>;
  }

  if (!allowed) {
    return <>{children}</>;
  }

  const loadError = error && !(error instanceof ApiError && error.status === 401)
    ? (error instanceof Error ? error.message : 'Failed to check handover status')
    : null;

  // Checking only on first load — keep workspace mounted underneath.
  const checking = pending === undefined && isLoading && !loadError;

  return (
    <>
      {children}

      {checking && (
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
            <ZButton variant="secondary" onClick={() => void mutate()}>
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
            onAccepted={async () => {
              await mutate(null, { revalidate: false });
              try {
                const sess = await machineHandoverService.ensureSession(machineCode);
                const sid = sess?.session
                  ? String(sess.session.session_id ?? sess.session.sessionId ?? '')
                  : '';
                if ((sess?.created || sess?.needsCrew) && sid) {
                  onHandoverAccepted?.(sid);
                }
              } catch {
                // Accept already succeeded; crew prompt can still appear on next init.
              }
            }}
          />
        </div>
      )}
    </>
  );
}
