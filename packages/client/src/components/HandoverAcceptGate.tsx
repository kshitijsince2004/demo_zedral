import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../lib/authStore';
import { machineHandoverService, type PendingHandover } from '../services/machineHandoverService';
import { HandoverAcceptPage } from '../pages/sixHi/HandoverAcceptPage';
import { ZButton } from './primitives/ZButton';

interface HandoverAcceptGateProps {
  machineCode: string;
  children: React.ReactNode;
}

/** Blocks CRM workspace until incoming operator accepts pending handover. */
export function HandoverAcceptGate({ machineCode, children }: HandoverAcceptGateProps) {
  const [pending, setPending] = useState<PendingHandover | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const machineAccess = useAuthStore((s) => s.machineAccess);

  const checkPending = useCallback(async () => {
    setLoadError(null);
    setPending(undefined);
    try {
      if (!machineAccess.includes(machineCode)) {
        setPending(null);
        return;
      }
      const { pending: p } = await machineHandoverService.getPending(machineCode);
      setPending(p);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to check handover status');
    }
  }, [machineCode, machineAccess]);

  useEffect(() => {
    void checkPending();
  }, [checkPending]);

  if (pending === undefined && !loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary text-muted-foreground text-sm">
        Checking handover status…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-secondary gap-4 p-6">
        <p className="text-sm text-destructive text-center max-w-md">{loadError}</p>
        <ZButton variant="secondary" onClick={() => void checkPending()}>
          Retry
        </ZButton>
      </div>
    );
  }

  if (pending) {
    return (
      <HandoverAcceptPage
        handover={pending}
        onAccepted={() => setPending(null)}
      />
    );
  }

  return <>{children}</>;
}
