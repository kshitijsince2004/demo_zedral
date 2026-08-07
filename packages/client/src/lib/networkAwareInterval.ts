import { Network } from '@capacitor/network';
import { getNetworkQuality, startNetworkQualityProbe } from './networkQuality';

type ConnectionType = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';

function webConnectionType(): ConnectionType | null {
  if (typeof navigator === 'undefined') return null;
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  const t = conn?.effectiveType;
  if (t === 'slow-2g' || t === '2g' || t === '3g' || t === '4g') return t;
  return t ? 'unknown' : null;
}

/** Pause aggressive polling on offline / 2G links. */
export async function shouldPauseLivePolling(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;

  try {
    const status = await Network.getStatus();
    if (!status.connected) return true;
  } catch {
    // Web fallback below.
  }

  const webType = webConnectionType();
  return webType === 'slow-2g' || webType === '2g';
}

/**
 * SWR refreshInterval callback — 0 on bad/offline; activeMs×2 clamped to 30–60s on
 * degraded; activeMs on good.
 */
export function networkAwareRefreshInterval(activeMs: number) {
  startNetworkQualityProbe();
  return async (): Promise<number> => {
    if (await shouldPauseLivePolling()) return 0;
    const { level, online } = getNetworkQuality();
    if (!online || level === 'bad') return 0;
    if (level === 'degraded') {
      return Math.min(60_000, Math.max(30_000, activeMs * 2));
    }
    return activeMs;
  };
}
