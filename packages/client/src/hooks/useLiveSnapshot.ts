import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveSnapshot, MachineLiveStatus } from '@m1/shared-validation';
import { liveService } from '../lib/liveService';
import { subscribeProductionChanged } from '../lib/productionSync';
import { jsonFingerprint } from '../lib/silentRefresh';

/** Shared poll interval for all live machine status views. */
export const LIVE_POLL_MS = 8_000;

export function machineStatusLabel(
  status: MachineLiveStatus,
): 'Running' | 'Stopped' | 'Idle' | 'Maintenance' {
  if (status === 'RUNNING') return 'Running';
  if (status === 'STOPPAGE' || status === 'BREAKDOWN') return 'Stopped';
  if (status === 'MAINTENANCE') return 'Maintenance';
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
    const id = setInterval(() => void refresh(), LIVE_POLL_MS);
    const unsub = subscribeProductionChanged(() => void refresh());
    return () => {
      clearInterval(id);
      unsub();
    };
  }, [enabled, refresh]);

  return { snapshot, loading, error, refresh };
}
