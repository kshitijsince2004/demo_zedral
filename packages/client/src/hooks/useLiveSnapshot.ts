import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveSnapshot, MachineLiveStatus } from '@m1/shared-validation';
import { liveService } from '../lib/liveService';
import { whenVisibleInterval } from '../lib/idleThrottle';
import { subscribeProductionChanged } from '../lib/productionSync';
import { jsonFingerprint } from '../lib/silentRefresh';

/** Shared poll interval for all live machine status views. */
export const LIVE_POLL_MS = 8_000;

export function machineStatusLabel(
  status: MachineLiveStatus,
): 'Running' | 'Stopped' | 'Breakdown' | 'Idle' | 'Maintenance' | 'Offline' {
  if (status === 'RUNNING') return 'Running';
  if (status === 'BREAKDOWN') return 'Breakdown';
  if (status === 'STOPPAGE') return 'Stopped';
  if (status === 'MAINTENANCE') return 'Maintenance';
  if (status === 'OFFLINE') return 'Offline';
  return 'Idle';
}

export function useLiveSnapshot(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevFingerprintRef = useRef('');

  const refresh = useCallback(async () => {
    try {
      const snap = await liveService.getSnapshot();
      const fingerprint = jsonFingerprint(snap);
      if (fingerprint !== prevFingerprintRef.current) {
        prevFingerprintRef.current = fingerprint;
        setSnapshot(snap);
      }
      setError(null);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Unable to load live data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const stopPoll = whenVisibleInterval(LIVE_POLL_MS, () => void refresh());
    const unsub = subscribeProductionChanged(() => void refresh());
    return () => {
      stopPoll();
      unsub();
    };
  }, [enabled, refresh]);

  return { snapshot, loading, error, refresh };
}
